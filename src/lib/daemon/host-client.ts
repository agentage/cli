import { isRecord } from '../fs/json-file.js';
import { CliError, DaemonError } from '../json-output.js';

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

// An install runs npm, a change starts a new child: both can take minutes.
const CHANGE_MS = 10 * 60_000;
const READ_MS = 10_000;

// The daemon's own codes (UPPER_SNAKE: NOT_FOUND, INVALID_SETTING) pass through unchanged.
const failure = (status: number, body: unknown): DaemonError => {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`;
  const code = typeof error['code'] === 'string' && error['code'] ? error['code'] : 'error';
  return new DaemonError(code, message);
};

const unreachable = (port: number, err: unknown): CliError =>
  new CliError('daemon_unavailable', `the daemon on 127.0.0.1:${port}: ${(err as Error).message}`);

type Send = <T>(method: string, path: string, body?: object) => Promise<T>;

const sender =
  (port: number): Send =>
  async <T>(method: string, path: string, body?: object): Promise<T> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'GET' ? READ_MS : CHANGE_MS),
    }).catch((err: unknown) => {
      throw unreachable(port, err);
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (!res.ok || !isRecord(parsed) || parsed['success'] !== true)
      throw failure(res.status, parsed);
    return parsed['data'] as T;
  };

const at = (id: string): string => `/host/extensions/${encodeURIComponent(id)}`;

export const hostClient = (port: number): HostClient => {
  const send = sender(port);
  return {
    list: () => send('GET', '/host/extensions'),
    add: (body) => send('POST', '/host/extensions', body),
    change: (id, patch) => send('PATCH', at(id), patch),
    remove: (id, purge) => send('DELETE', `${at(id)}${purge ? '?purge=true' : ''}`),
  };
};
