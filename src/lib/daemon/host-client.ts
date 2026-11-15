import { isRecord } from '../fs/json-file.js';
import { CliError, DaemonError, messageOf } from '../json-output.js';

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
}

// An install runs npm (up to 10 min in the daemon), then starts the child: past that it is stuck.
const WAITS = { read: 10_000, change: 12 * 60_000 };

// The daemon's own codes (UPPER_SNAKE: NOT_FOUND, INVALID_SETTING) pass through unchanged.
const failure = (status: number, body: unknown): DaemonError => {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`;
  const code = typeof error['code'] === 'string' && error['code'] ? error['code'] : 'error';
  return new DaemonError(code, message);
};

// What the user can see after a timeout: the kit adds the row only once the install ends, and its
// /health names no install in progress.
const LOOK: Record<string, string> = {
  GET: 'agentage daemon status',
  POST:
    'the install may still run in the daemon, and no row shows until it ends; ' +
    'agentage daemon status says the daemon runs; run agentage extension list again in a few minutes',
  PATCH: 'the change may still finish; run agentage extension list again in a few minutes',
};

// A timed-out change may still finish in the daemon: say how to look, never that it failed.
const unreachable = (port: number, err: unknown, ms: number, method: string): CliError => {
  if ((err as Error).name !== 'TimeoutError')
    return new CliError('daemon_unavailable', `the daemon on 127.0.0.1:${port}: ${messageOf(err)}`);
  const after = `the daemon on 127.0.0.1:${port} did not answer in ${ms / 1000} s`;
  const look = LOOK[method] ?? LOOK['PATCH'];
  return new CliError('timeout', `${after}; ${look}`);
};

type Send = <T>(method: string, path: string, body?: object) => Promise<T>;

const sender =
  (port: number, waits: typeof WAITS): Send =>
  async <T>(method: string, path: string, body?: object): Promise<T> => {
    const ms = method === 'GET' ? waits.read : waits.change;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    }).catch((err: unknown) => {
      throw unreachable(port, err, ms, method);
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (!res.ok || !isRecord(parsed) || parsed['success'] !== true)
      throw failure(res.status, parsed);
    return parsed['data'] as T;
  };

const at = (id: string): string => `/host/extensions/${encodeURIComponent(id)}`;

export const hostClient = (port: number, waits = WAITS): HostClient => {
  const send = sender(port, waits);
  return {
    list: () => send('GET', '/host/extensions'),
    add: (body) => send('POST', '/host/extensions', body),
    change: (id, patch) => send('PATCH', at(id), patch),
    remove: (id, purge) => send('DELETE', `${at(id)}${purge ? '?purge=true' : ''}`),
  };
};
