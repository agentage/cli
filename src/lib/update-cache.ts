import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from './config.js';
import { compareVersions, fetchCliLatest, INSTALL_HINT, type CliLatest } from './update-check.js';
import { VERSION } from '../utils/version.js';

const CACHE_FILE = 'update-check.json';
const TTL_MS = 60 * 60 * 1000; // passive checks refresh at most once an hour
const BG_TIMEOUT_MS = 3000; // tighter than the foreground check so a cold run never lingers

export interface UpdateCache {
  checkedAt: number; // epoch ms of the last successful check
  latest: string | null; // latest published version, or null when unknown
}

const cachePath = (): string => join(getConfigDir(), CACHE_FILE);

export const readUpdateCache = (): UpdateCache | null => {
  try {
    const c = JSON.parse(readFileSync(cachePath(), 'utf-8')) as UpdateCache;
    return typeof c.checkedAt === 'number' ? c : null;
  } catch {
    return null;
  }
};

const writeUpdateCache = (latest: string, now: number): void => {
  ensureConfigDir();
  writeFileSync(cachePath(), JSON.stringify({ checkedAt: now, latest }) + '\n', 'utf-8');
};

// The one dim hint line printed after a command, read purely from the cache (never the network),
// only when the cached latest is newer than us. null = print nothing.
export const updateHint = (): string | null => {
  const c = readUpdateCache();
  if (!c?.latest) return null;
  return compareVersions(VERSION, c.latest) < 0
    ? `update available: ${c.latest} -> ${INSTALL_HINT}`
    : null;
};

export interface RefreshDeps {
  now?: () => number;
  read?: () => UpdateCache | null;
  fetch?: () => Promise<CliLatest | null>;
  write?: (latest: string, now: number) => void;
}

// Fire-and-forget refresh: only fetches when the cache is absent or older than the TTL, so a warm
// cache keeps the process instant. Bounded by fetch's own timeout; every failure is swallowed.
export const refreshUpdateCache = async (deps: RefreshDeps = {}): Promise<void> => {
  const now = (deps.now ?? Date.now)();
  const cached = (deps.read ?? readUpdateCache)();
  if (cached && now - cached.checkedAt < TTL_MS) return;
  try {
    const latest = await (deps.fetch ?? (() => fetchCliLatest(BG_TIMEOUT_MS)))();
    if (latest?.version) (deps.write ?? writeUpdateCache)(latest.version, now);
  } catch {
    // total silence: a background check never disrupts a command
  }
};
