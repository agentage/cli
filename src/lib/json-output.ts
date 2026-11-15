import { CommanderError, type Command } from 'commander';
import { NotPushedError } from '../core/profile/cloud.js';
import { AuthRequiredError, TransientAuthError } from './auth/auth-errors.js';
import { TokenRequestError } from './auth/oauth.js';

// An error with a stable snake_case code for `--json`; any other error is `error`.
export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const KNOWN: [new (...args: never[]) => Error, string][] = [
  [AuthRequiredError, 'auth_required'],
  [TransientAuthError, 'auth_unavailable'],
  [NotPushedError, 'not_pushed'],
  [TokenRequestError, 'token_request_failed'],
];

export const codeOf = (err: unknown): string => {
  if (err instanceof CliError) return err.code;
  return KNOWN.find(([type]) => err instanceof type)?.[1] ?? 'error';
};

export interface JsonIo {
  writeOut: (text: string) => void;
}

// `shown`: the failure is already on stdout (or is a commander exit), so the caller prints nothing.
export interface Failure {
  err: unknown;
  shown: boolean;
}

let active = false;

// True inside a --json run: nothing may prompt.
export const isJsonRun = (): boolean => active;

export const isJson = (opts: unknown): boolean =>
  typeof opts === 'object' && opts !== null && (opts as { json?: unknown }).json === true;

export const attempt = async (run: () => Promise<unknown>): Promise<Failure | null> =>
  run().then(
    () => null,
    (err: unknown) => ({ err, shown: false })
  );

// Runs one command with stdout reserved for the envelope: progress lines go to stderr.
// `legacy` keeps the command's own JSON on stdout (its shape is pinned); only an error before
// it printed anything becomes the error envelope.
export const runJson = async (
  io: JsonIo,
  run: () => Promise<unknown>,
  legacy = false
): Promise<Failure | null> => {
  const log = console.log;
  let wrote = false;
  active = true;
  console.log = (...args: unknown[]): void => {
    if (!legacy) return console.error(...args);
    wrote = true;
    log(...args);
  };
  try {
    let data: unknown = null;
    const failure = await attempt(async () => {
      data = (await run()) ?? null;
    });
    if (!failure) {
      if (!legacy) io.writeOut(`${JSON.stringify({ success: true, data })}\n`);
      return null;
    }
    const { err } = failure;
    if (err instanceof CommanderError) return { err, shown: true };
    if (wrote) return { err, shown: false };
    const error = { code: codeOf(err), message: err instanceof Error ? err.message : String(err) };
    io.writeOut(`${JSON.stringify({ success: false, error })}\n`);
    return { err, shown: true };
  } finally {
    console.log = log;
    active = false;
  }
};

// The one --json option every command carries.
export const addJson = (command: Command): Command =>
  command.option(
    '--json',
    'one JSON object on stdout: { success, data } or { success: false, error }'
  );
