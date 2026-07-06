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
import { resolvePort } from '../daemon/lifecycle.js';
import { type SyncResult } from '../sync/cycle.js';
import { type SyncStatus } from '../sync/manager.js';
import { VERSION } from '../utils/version.js';
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

const post = async <T>(port: number, verb: string, body: unknown): Promise<T> => {
  const res = await fetch(`${base(port)}/api/memory/${verb}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as SyncStatus) : null;
  } catch {
    return null;
  }
};

// Ask the daemon to sync one vault now; the daemon runs the cycle in its own process.
export const syncRun = async (port: number, vault: string): Promise<SyncResult> => {
  const res = await fetch(`${base(port)}/api/sync/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vault }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `sync request failed: ${res.status}`);
  }
  return res.json() as Promise<SyncResult>;
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

// Detached spawn (not fork: fork's IPC channel keeps the parent event loop alive past unref) so
// the daemon outlives this CLI; ignore stdio + unref so the CLI can exit. Returns false (never
// throws) when spawning is blocked - callers then fall back to a DirectClient.
export const spawnDaemon = async (
  port: number,
  opts: { timeoutMs?: number } = {}
): Promise<boolean> => {
  try {
    const child = spawnChild(process.execPath, [entryPath()], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTAGE_DAEMON_PORT: String(port) },
    });
    child.unref();
  } catch {
    return false;
  }
  return waitForHealth(port, { timeoutMs: opts.timeoutMs ?? 4000 });
};

export interface EnsureDeps {
  port?: number;
  probe?: (port: number) => Promise<Health | null>;
  spawn?: (port: number) => Promise<boolean>;
}

// DO3/DO4/DO9: prefer a live daemon, autostart one if absent, and return null when it is
// unreachable or cannot be forked so the caller falls back to the in-process DirectClient.
export const ensureDaemon = async (deps: EnsureDeps = {}): Promise<MemoryClient | null> => {
  const port = deps.port ?? resolvePort();
  const probe = deps.probe ?? health;
  const spawn = deps.spawn ?? spawnDaemon;
  const existing = await probe(port);
  if (existing) {
    const notice = mismatchNotice(existing.version);
    if (notice) console.error(chalk.yellow(notice));
    return createDaemonClient(port);
  }
  const started = await spawn(port).catch(() => false);
  return started ? createDaemonClient(port) : null;
};
