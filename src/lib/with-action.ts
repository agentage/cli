import chalk from 'chalk';
import { CommanderError } from 'commander';
import { attempt, isJson, messageOf, runJson, type JsonIo } from './json-output.js';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const ACTION_FAILED = 'agentage.actionFailed';

type Legacy = (opts: never) => boolean;
export const notPinned: Legacy = () => false;
export const pinned: Legacy = () => true;

// AGENTAGE_DEBUG=1: the original error and its cause, with stacks, on stderr; never on stdout.
const debugStack = (io: { writeErr: (text: string) => void }, err: unknown): void => {
  if (process.env['AGENTAGE_DEBUG'] !== '1') return;
  for (let e: unknown = err; e instanceof Error; e = (e as { cause?: unknown }).cause)
    io.writeErr(`${e.stack ?? String(e)}\n`);
};

// One failure path: a red stderr line, exit 1, or with --json the error envelope on stdout.
// `legacy` marks a run whose own JSON is pinned; an extension's --help or usage error keeps its code.
export const withAction =
  <T>(
    io: JsonIo & { writeErr: (text: string) => void },
    fn: (opts: T) => Promise<unknown>,
    prefix = '',
    legacy: Legacy = notPinned
  ) =>
  async (opts: T): Promise<void> => {
    const run = () => fn(opts);
    const failure = isJson(opts)
      ? await runJson(io, run, legacy(opts as never))
      : await attempt(run);
    if (!failure) return;
    const { err, shown } = failure;
    if (err instanceof CommanderError) throw err;
    debugStack(io, err);
    if (!shown) io.writeErr(`${chalk.red(`${prefix}${messageOf(err)}`)}\n`);
    throw new CommanderError(EXIT_FAILED, ACTION_FAILED, messageOf(err));
  };
