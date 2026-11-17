import { isRecord } from '../fs/json-file.js';
import { CliError, DaemonError, messageOf } from '../json-output.js';
import { daemonFailure } from './daemon-answer.js';
import { daemonFilePath, readHostToken } from './daemon-file.js';
import { provenPort } from './daemon-probe.js';

// One row of GET /host/extensions (C5); the daemon may add fields, they pass through.
export interface HostRow {
  id: string;
  version: string;
  source: string;
  state: string;
  enabled: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface HostSummary {
  id: string;
  version: string;
  state: string;
  error?: string;
}

export interface HostPatch {
  version?: string;
  enabled?: boolean;
  settings?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface HostClient {
  list: () => Promise<HostRow[]>;
  // enabled: false only to a daemon whose kit lists installDisabled.
  add: (
    body: ({ id: string; version?: string } | { source: string }) & { enabled?: false }
  ) => Promise<HostSummary>;
  change: (id: string, patch: HostPatch) => Promise<HostSummary>;
  remove: (id: string, purge: boolean) => Promise<{ id: string }>;
  // S1.1.3 L1: the daemon copies <folder>/dist.next to dist and restarts that one child.
  // S1.2.3: part 'app' keeps the child; the daemon tells the open shell to re-import dist/app.
  reload: (id: string, part?: 'app') => Promise<HostReload>;
}

export interface HostReload {
  id: string;
  version: string;
  state: string;
  pid?: number;
  reloaded: boolean;
  refused?: string;
  part?: string;
}

// An install runs npm (the daemon waits up to 660 s), then starts the child: past that it is stuck.
// A reload: drain 10 s, start and health 60 s each, and the same again to restore: past 5 min stuck.
const WAITS: Waits = { read: 10_000, change: 12 * 60_000, reload: 5 * 60_000 };

export interface Waits {
  read: number;
  change: number;
  reload?: number;
}

// A change can finish after this wait (queue and installer 11 min each); /health lists it pending.
const LOOK: Record<string, string> = {
  GET: 'agentage daemon status',
  POST: 'the daemon may still finish the install: agentage daemon status shows it under pending, then agentage extension list shows if it was installed',
  PATCH:
    'the daemon may still finish the change: agentage daemon status shows it under pending, then agentage extension list shows the version',
  RELOAD: 'agentage extension list shows its state; agentage daemon restart if it stays so',
};

// A timed-out change may still finish in the daemon: say how to look, never that it failed.
const unreachable = (port: number, err: unknown, ms: number, method: string): CliError => {
  if ((err as Error).name !== 'TimeoutError')
    return new CliError('daemon_unavailable', `the daemon on 127.0.0.1:${port}: ${messageOf(err)}`);
  const after = `the daemon on 127.0.0.1:${port} did not answer in ${ms / 1000} s`;
  const look = LOOK[method] ?? LOOK['PATCH'];
  return new CliError('timeout', `${after}; ${look}`);
};

// A body that is no envelope is not the daemon's answer (a proxy, a crash page, another program).
const foreign = (port: number, status: number): CliError =>
  new CliError(
    'daemon_unavailable',
    `127.0.0.1:${port} answered HTTP ${status} with no agentage answer; agentage daemon status shows what runs there, agentage daemon restart starts it again`
  );

type Send = <T>(method: string, path: string, body?: object, kind?: string) => Promise<T>;
type Token = () => string | undefined;

const headersOf = (
  body: object | undefined,
  token: string | undefined
): Record<string, string> => ({
  ...(body && { 'content-type': 'application/json' }),
  ...(token && { authorization: `Bearer ${token}` }),
});

const REFUSED = [401, 403];

// A token that stays refused: daemon.json names another daemon than the one on the port.
const tokenRefused = (err: DaemonError): DaemonError =>
  new DaemonError(
    err.code,
    `the daemon refused the host token of ${daemonFilePath()} (${err.message}); run agentage daemon restart`,
    err.status,
    err.details
  );

type Same = (port: number) => Promise<boolean>;

interface Target {
  port: number;
  waits: Waits;
  token: Token;
  same: Same;
}

// A retry with a new token only when daemon.json still names this port and its pid answers there.
export const sameDaemon: Same = async (port) => (await provenPort()) === port;

const waitOf = ({ waits }: Target, kind: string): number =>
  kind === 'GET' ? waits.read : kind === 'RELOAD' ? (waits.reload ?? waits.read) : waits.change;

const sendOnce = async <T>(
  to: Target,
  method: string,
  path: string,
  body?: object,
  kind = method
): Promise<T> => {
  const ms = waitOf(to, kind);
  const res = await fetch(`http://127.0.0.1:${to.port}${path}`, {
    method,
    headers: headersOf(body, to.token()),
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
    redirect: 'error',
  }).catch((err: unknown) => {
    throw unreachable(to.port, err, ms, kind);
  });
  const parsed: unknown = await res.json().catch(() => null);
  if (!isRecord(parsed) || typeof parsed['success'] !== 'boolean')
    throw foreign(to.port, res.status);
  if (!res.ok || parsed['success'] !== true) throw daemonFailure(res.status, parsed);
  return parsed['data'] as T;
};

const refused = (err: unknown): err is DaemonError =>
  err instanceof DaemonError && REFUSED.includes(err.status);

// 401 or 403 is refused before any change: daemon.json is read again (a new daemon), once.
const sender =
  (to: Target): Send =>
  <T>(method: string, path: string, body?: object, kind = method): Promise<T> =>
    sendOnce<T>(to, method, path, body, kind).catch(async (err: unknown) => {
      if (!refused(err)) throw err;
      if (!(await to.same(to.port))) throw tokenRefused(err);
      return sendOnce<T>(to, method, path, body, kind).catch((again: unknown) => {
        throw refused(again) ? tokenRefused(again) : again;
      });
    });

const at = (id: string): string => `/host/extensions/${encodeURIComponent(id)}`;

export const hostClient = (
  port: number,
  waits = WAITS,
  token: Token = readHostToken,
  same: Same = sameDaemon
): HostClient => {
  const send = sender({ port, waits, token, same });
  return {
    list: () => send('GET', '/host/extensions'),
    add: (body) => send('POST', '/host/extensions', body),
    change: (id, patch) => send('PATCH', at(id), patch),
    remove: (id, purge) => send('DELETE', `${at(id)}${purge ? '?purge=true' : ''}`),
    reload: (id, part) => send('POST', `${at(id)}/reload`, part ? { part } : {}, 'RELOAD'),
  };
};
