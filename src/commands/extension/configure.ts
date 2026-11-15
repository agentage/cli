import { CliError, isJsonRun } from '../../lib/json-output.js';
import { report, specOf, type LifecycleDeps } from './lifecycle.js';

export interface ConfigureOptions {
  id: string;
  pairs: string[];
  secret?: boolean;
  json?: boolean;
}

// A secret with no `=value`: stdin when it is not a terminal, else a hidden prompt.
export interface SecretInput {
  isTTY: boolean;
  readStdin: () => Promise<string>;
  prompt: (question: string) => Promise<string>;
}

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

// The daemon starts a new child with the values, then moves the route: no request is lost.
export const runConfigure = async (
  opts: ConfigureOptions,
  deps: LifecycleDeps & { input: SecretInput }
) => {
  const { id } = specOf(opts.id);
  const values = await valuesOf(opts, deps.input);
  const patch = opts.secret ? { secrets: values } : { settings: values };
  const done = report(await (await deps.host()).change(id, patch));
  const keys = Object.keys(values);
  console.log(`${opts.secret ? 'secrets' : 'settings'} set: ${keys.join(', ')}`);
  return { ...done, keys };
};
