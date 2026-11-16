import { CommanderError, type Command } from 'commander';
import { NotPushedError } from '../core/profile/cloud.js';
import { AuthRequiredError, TransientAuthError } from './auth/auth-errors.js';
import { TokenRequestError } from './auth/oauth.js';

// Every code of the cli's own: docs/reference.md lists the same, and a test keeps them equal.
export const CODES = [
  'already_installed',
  'already_running',
  'auth_required',
  'auth_unavailable',
  'build_failed',
  'cancelled',
  'confirmation_required',
  'daemon_disabled',
  'daemon_unavailable',
  'daemon_unresponsive',
  'disk_full',
  'error',
  'extension_failed',
  'integrity_drift',
  'invalid_argument',
  'market_failed',
  'market_timeout',
  'market_unreachable',
  'needed_by_dependents',
  'network_unavailable',
  'no_discovery',
  'no_market',
  'not_conforming',
  'not_installed',
  'not_pushed',
  'permission_denied',
  'port_in_use',
  'profile_invalid',
  'release_refused',
  'stop_failed',
  'timeout',
  'token_request_failed',
  'uncommitted_changes',
  'usage',
] as const;

export type Code = (typeof CODES)[number];

// An error with a stable snake_case code for `--json`; any other error is `error`.
export class CliError extends Error {
  constructor(
    readonly code: Code,
    message: string
  ) {
    super(message);
  }
}

// The daemon's own code (NOT_FOUND, INVALID_SETTING) and details (START_FAILED), as it gives them.
export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const KNOWN: [new (...args: never[]) => Error, Code][] = [
  [AuthRequiredError, 'auth_required'],
  [TransientAuthError, 'auth_unavailable'],
  [NotPushedError, 'not_pushed'],
  [TokenRequestError, 'token_request_failed'],
];

// What the system says of an expected failure: a folder or file we may not use, a full disk.
const ERRNO: Record<string, Code> = {
  EACCES: 'permission_denied',
  EPERM: 'permission_denied',
  EROFS: 'permission_denied',
  ENOSPC: 'disk_full',
  EDQUOT: 'disk_full',
};

const systemCode = (err: unknown): Code | undefined => {
  if (!(err instanceof Error)) return undefined;
  if (err.name === 'TimeoutError') return 'timeout';
  if (err instanceof TypeError && err.message === 'fetch failed') return 'network_unavailable';
  return ERRNO[(err as NodeJS.ErrnoException).code ?? ''];
};

export const codeOf = (err: unknown): string => {
  if (err instanceof CliError || err instanceof DaemonError) return err.code;
  return KNOWN.find(([type]) => err instanceof type)?.[1] ?? systemCode(err) ?? 'error';
};

export interface JsonIo {
  writeOut: (text: string) => void;
}

// `shown`: the failure is already on stdout (or is a commander exit), so the caller prints nothing.
export interface Failure {
  err: unknown;
  shown: boolean;
}

// A command's answer with `meta` beside `data` in the --json envelope.
export class WithMeta {
  constructor(
    readonly data: unknown,
    readonly meta: Record<string, unknown>
  ) {}
}

const envelope = (data: unknown): string =>
  JSON.stringify({ success: true, ...(data instanceof WithMeta ? data : { data }) });

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

// fetch says only "fetch failed"; its cause names the host and why (ECONNREFUSED, ENOTFOUND).
export const messageOf = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const why = err.message === 'fetch failed' && cause instanceof Error ? `: ${cause.message}` : '';
  return `${err.message}${why}`;
};

export const writeError = (io: JsonIo, err: unknown, code: string = codeOf(err)): void => {
  const details = err instanceof DaemonError && Object.keys(err.details).length && err.details;
  const error = { code, message: messageOf(err), ...(details && { details }) };
  io.writeOut(`${JSON.stringify({ success: false, error })}\n`);
};

// Progress goes to stderr; a pinned command keeps stdout and we note that it printed.
const redirectLog = (legacy: boolean): { wrote: () => boolean; restore: () => void } => {
  const log = console.log;
  let wrote = false;
  console.log = (...args: unknown[]): void => {
    if (!legacy) return console.error(...args);
    wrote = true;
    log(...args);
  };
  return { wrote: () => wrote, restore: () => void (console.log = log) };
};

const failureOf = (io: JsonIo, { err }: Failure, wrote: boolean): Failure => {
  if (err instanceof CommanderError) return { err, shown: true };
  if (wrote) return { err, shown: false };
  writeError(io, err);
  return { err, shown: true };
};

// Stdout is reserved for the envelope; `legacy` keeps a command's own pinned JSON instead.
export const runJson = async (
  io: JsonIo,
  run: () => Promise<unknown>,
  legacy = false
): Promise<Failure | null> => {
  const log = redirectLog(legacy);
  active = true;
  try {
    let data: unknown = null;
    const failure = await attempt(async () => {
      data = (await run()) ?? null;
    });
    if (failure) return failureOf(io, failure, log.wrote());
    if (!legacy) io.writeOut(`${envelope(data)}\n`);
    return null;
  } finally {
    log.restore();
    active = false;
  }
};

// A copy of the options without the flag, for a call that hands them on.
export const omitJson = <T extends { json?: boolean }>(opts: T): Omit<T, 'json'> => {
  const copy = { ...opts };
  delete copy.json;
  return copy;
};

// The one --json option every command carries.
export const addJson = (command: Command): Command =>
  command.option(
    '--json',
    'one JSON object on stdout: { success, data } or { success: false, error }'
  );
