import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import {
  type EditInput,
  type ListResult,
  type MemoryView,
  type SearchResult,
  type WriteResult,
} from '@agentage/memory-core';
import { EADDRINUSE_EXIT_CODE, readDaemonToken, resolvePort } from '../daemon/lifecycle.js';
import { type SyncResult } from '../sync/cycle.js';
import { type CouchSyncResult } from '../sync/couch/manager.js';
import { type SyncStatus } from '../sync/manager.js';
import { VERSION } from '../utils/version.js';

// One vault syncs on exactly one channel; /api/sync/run yields whichever result fits the vault.
export type SyncRunResult = SyncResult | CouchSyncResult;
import {
  type DeleteResult,
  type ListOptions,
  type MemoryClient,
  type SearchOptions,
  type VerbOptions,
} from './memory-client.js';

export interface Health {
  ok: boolean;
  version: string;
  pid: number;
  uptime: number;
  served: number;
}

const base = (port: number): string => `http://127.0.0.1:${port}`;

// The 0600 token file is the daemon's auth: read it fresh per call so a restart's new token is
// picked up; absent means we cannot authenticate, so /api/* will 401 and callers fall back.
const apiHeaders = (): Record<string, string> => {
  const token = readDaemonToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-Agentage-Token': token } : {}) };
};

const post = async <T>(port: number, verb: string, body: unknown): Promise<T> => {
  const res = await fetch(`${base(port)}/api/memory/${verb}`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `daemon request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export const health = async (port: number, timeoutMs = 1000): Promise<Health | null> => {
  try {
    const res = await fetch(`${base(port)}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
};

// Read the daemon's per-vault sync state (last run, last error); null when the endpoint is absent
// (an older daemon) or unreachable.
export const syncStatus = async (port: number, timeoutMs = 1000): Promise<SyncStatus | null> => {
  try {
    const res = await fetch(`${base(port)}/api/sync/status`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as SyncStatus) : null;
  } catch {
    return null;
  }
};

// Ask the daemon to sync one vault now; the daemon runs the cycle in its own process. The result
// shape depends on the vault's channel (git SyncResult vs account CouchSyncResult).
export const syncRun = async (port: number, vault: string): Promise<SyncRunResult> => {
  const res = await fetch(`${base(port)}/api/sync/run`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ vault }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `sync request failed: ${res.status}`);
  }
  return res.json() as Promise<SyncRunResult>;
};

export const waitForHealth = async (
  port: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> => {
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  while (Date.now() < deadline) {
    if (await health(port, intervalMs + 200)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
};

// A thin MemoryClient over HTTP: every method is a pass-through POST; the daemon's in-process
// DirectClient does the vault scoping, so the wire carries the raw ref + opts unchanged.
export const createDaemonClient = (port: number): MemoryClient => ({
  search: (query: string, opts?: SearchOptions) =>
    post<SearchResult>(port, 'search', { query, opts }),
  read: (ref: string, opts?: VerbOptions) => post<MemoryView>(port, 'read', { ref, opts }),
  write: (
    ref: string,
    body: string,
    opts?: VerbOptions & { frontmatter?: Record<string, unknown> }
  ) => post<WriteResult>(port, 'write', { ref, body, opts }),
  edit: (ref: string, op: Omit<EditInput, 'path'>, opts?: VerbOptions) =>
    post<WriteResult>(port, 'edit', { ref, op, opts }),
  list: (folder: string | undefined, opts?: ListOptions) =>
    post<ListResult>(port, 'list', { folder, opts }),
  delete: (ref: string, opts?: VerbOptions) => post<DeleteResult>(port, 'delete', { ref, opts }),
});

// A restart hint when the running daemon predates the current binary.
export const mismatchNotice = (daemonVersion: string): string | null =>
  daemonVersion === VERSION
    ? null
    : `daemon version ${daemonVersion} != cli ${VERSION}; restart with: agentage daemon stop && agentage daemon start`;

const entryPath = (): string => fileURLToPath(new URL('../daemon-entry.js', import.meta.url));

// Why the autostart failed: a busy port (foreign process) needs a distinct user message and lets
// callers avoid paying the full health wait; the others just mean "fall back to a DirectClient".
export type SpawnOutcome =
  { ok: true } | { ok: false; reason: 'port-in-use' | 'unreachable' | 'blocked' };

// Detached spawn (not fork: fork's IPC channel keeps the parent event loop alive past unref) so
// the daemon outlives this CLI; ignore stdio + unref so the CLI can exit. Watches the child's exit
// so a fast EADDRINUSE death short-circuits the health wait instead of burning the full timeout.
export const spawnDaemon = async (
  port: number,
  opts: { timeoutMs?: number } = {}
): Promise<SpawnOutcome> => {
  let child: ReturnType<typeof spawnChild>;
  try {
    child = spawnChild(process.execPath, [entryPath()], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTAGE_DAEMON_PORT: String(port) },
    });
  } catch {
    return { ok: false, reason: 'blocked' };
  }
  const exited = new Promise<SpawnOutcome>((resolve) => {
    child.once('exit', (code) =>
      resolve({ ok: false, reason: code === EADDRINUSE_EXIT_CODE ? 'port-in-use' : 'unreachable' })
    );
  });
  child.unref();
  const healthy = waitForHealth(port, { timeoutMs: opts.timeoutMs ?? 4000 }).then(
    (ok): SpawnOutcome => (ok ? { ok: true } : { ok: false, reason: 'unreachable' })
  );
  return Promise.race([healthy, exited]);
};

export interface EnsureDeps {
  port?: number;
  probe?: (port: number) => Promise<Health | null>;
  spawn?: (port: number) => Promise<SpawnOutcome>;
  readToken?: () => string | null;
}

// DO3/DO4/DO9: prefer a live daemon, autostart one if absent, and return null when it is
// unreachable, cannot be spawned, or has no readable token (nothing to authenticate with) so the
// caller falls back to the in-process DirectClient.
export const ensureDaemon = async (deps: EnsureDeps = {}): Promise<MemoryClient | null> => {
  const port = deps.port ?? resolvePort();
  const probe = deps.probe ?? health;
  const spawn = deps.spawn ?? spawnDaemon;
  const readToken = deps.readToken ?? readDaemonToken;
  const existing = await probe(port);
  if (existing) {
    if (!readToken()) return null;
    const notice = mismatchNotice(existing.version);
    if (notice) console.error(chalk.yellow(notice));
    return createDaemonClient(port);
  }
  const outcome = await spawn(port).catch((): SpawnOutcome => ({ ok: false, reason: 'blocked' }));
  return outcome.ok && readToken() ? createDaemonClient(port) : null;
};
