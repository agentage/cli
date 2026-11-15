import { join } from 'node:path';
import { installationRows } from '../../core/loader/installed.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { CliError, DaemonError, isJsonRun } from '../../lib/json-output.js';
import { report, specOf, type ConfirmIo, type LifecycleDeps } from './lifecycle.js';

export interface ConfigureOptions {
  id: string;
  pairs: string[];
  secret?: boolean;
  json?: boolean;
}

// A secret with no `=value`: stdin when it is not a terminal, else a hidden prompt.
export interface SecretInput extends ConfirmIo {
  readStdin: () => Promise<string>;
}

const ENTER = ['\r', '\n', '\u0004'];
const CTRL_C = '\u0003';
const BACKSPACE = '\u007f';

// One keypress: the answer so far, or null once Enter ends it.
const typed = (answer: string, char: string): string | null => {
  if (ENTER.includes(char)) return null;
  return char === BACKSPACE ? answer.slice(0, -1) : answer + char;
};

// Raw mode keeps the answer off the screen; Ctrl+C still interrupts once the terminal is restored.
type Tty = Pick<NodeJS.ReadStream, 'on' | 'off' | 'setRawMode' | 'resume' | 'pause'>;

export const readHidden = (
  question: string,
  { stdin, stderr }: { stdin: Tty; stderr: Pick<NodeJS.WriteStream, 'write'> } = process
): Promise<string> =>
  new Promise((resolve) => {
    let answer = '';
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf-8')) {
        const next = char === CTRL_C ? null : typed(answer, char);
        if (next === null) return finish(char === CTRL_C);
        answer = next;
      }
    };
    const finish = (interrupted: boolean): void => {
      stdin.off('data', onData).setRawMode(false).pause();
      stderr.write('\n');
      resolve(answer);
      if (interrupted) process.kill(process.pid, 'SIGINT');
    };
    stderr.write(question);
    stdin.setRawMode(true).resume().on('data', onData);
  });

const readAll = async (): Promise<string> => {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
};

export const stdinInput = (prompt: SecretInput['prompt']): SecretInput => ({
  isTTY: process.stdin.isTTY === true,
  readStdin: readAll,
  prompt,
});

const secretValue = async (key: string, input: SecretInput): Promise<string> => {
  if (!input.isTTY) return (await input.readStdin()).replace(/\r?\n$/, '');
  if (isJsonRun())
    throw new CliError('confirmation_required', `${key}: with --json, give the value on stdin`);
  return input.prompt(`${key}: `);
};

// `key=value` pairs; with --secret a single bare key reads its value instead.
const valuesOf = async (opts: ConfigureOptions, input: SecretInput) => {
  const values: Record<string, string> = {};
  for (const pair of opts.pairs) {
    const at = pair.indexOf('=');
    if (at > 0) values[pair.slice(0, at)] = pair.slice(at + 1);
    else if (at < 0 && opts.secret && opts.pairs.length === 1)
      values[pair] = await secretValue(pair, input);
    else throw new CliError('invalid_argument', `${pair}: expected <key>=<value>`);
  }
  return values;
};

// The keys the installed package declares (null: its folder is not on this disk).
const declaredOf = (id: string): string[] | null => {
  const dir = installationRows().find((row) => row.id === id)?.dir;
  if (!dir) return null;
  const agentage = readJson(join(dir, 'package.json'), isRecord)?.['agentage'];
  const settings = isRecord(agentage) ? agentage['settings'] : undefined;
  return Object.keys(isRecord(settings) ? settings : {});
};

// The daemon names the key it refused; the answer adds the keys the extension does declare.
const withDeclared = (id: string, err: unknown): unknown => {
  if (!(err instanceof DaemonError) || !/not declared/.test(err.message)) return err;
  const keys = declaredOf(id);
  const tail =
    keys === null
      ? 'see agentage.settings in its package.json'
      : keys.length > 0
        ? `${id} declares: ${keys.join(', ')}`
        : `${id} declares no settings`;
  return new DaemonError(err.code, `${err.message}; ${tail}`);
};

// The daemon starts a new child with the values, then moves the route: no request is lost.
export const runConfigure = async (
  opts: ConfigureOptions,
  deps: LifecycleDeps & { input: SecretInput }
) => {
  const { id } = specOf(opts.id);
  const values = await valuesOf(opts, deps.input);
  const patch = opts.secret ? { secrets: values } : { settings: values };
  const changed = (await deps.host()).change(id, patch).catch((err: unknown) => {
    throw withDeclared(id, err);
  });
  const done = report(await changed);
  const keys = Object.keys(values);
  console.log(`${opts.secret ? 'secrets' : 'settings'} set: ${keys.join(', ')}`);
  return { ...done, keys };
};
