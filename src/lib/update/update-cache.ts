import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from '../fs/config.js';
import { fetchJsonUnref } from '../net/http.js';
import { compareVersions, INSTALL_HINT, REGISTRY_URL } from './update-check.js';
import { VERSION } from '../../utils/version.js';

const CACHE_FILE = 'update-check.json';
const TTL_MS = 60 * 60 * 1000; // passive checks refresh at most once an hour
const BG_TIMEOUT_MS = 3000; // hard cap on the whole background attempt, connect included

export interface UpdateCache {
  checkedAt: number; // epoch ms of the last attempt, success or failure (throttles retries)
  latest: string | null; // latest published version, or null when never fetched
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

const writeUpdateCache = (latest: string | null, now: number): void => {
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

// Shares fetchJsonUnref (node:https, unref'd timer) so an offline background check never stalls
// process exit the way an aborted global fetch does.
export const fetchLatestVersion = async (
  timeoutMs: number,
  url: string = REGISTRY_URL
): Promise<string | null> => {
  const res = await fetchJsonUnref(url, timeoutMs);
  if (!res?.ok) return null;
  const v = (res.json as { version?: unknown } | null)?.version;
  return typeof v === 'string' ? v : null;
};

export interface RefreshDeps {
  now?: () => number;
  read?: () => UpdateCache | null;
  fetch?: () => Promise<string | null>;
  write?: (latest: string | null, now: number) => void;
}

// Fire-and-forget refresh, throttled by the TTL. checkedAt advances on FAILURE too (keeping any
// previously known version), so an offline machine retries once an hour, not on every command.
export const refreshUpdateCache = async (deps: RefreshDeps = {}): Promise<void> => {
  const now = (deps.now ?? Date.now)();
  const cached = (deps.read ?? readUpdateCache)();
  if (cached && now - cached.checkedAt < TTL_MS) return;
  let version: string | null = null;
  try {
    version = await (deps.fetch ?? (() => fetchLatestVersion(BG_TIMEOUT_MS)))();
  } catch {
    version = null;
  }
  try {
    (deps.write ?? writeUpdateCache)(version ?? cached?.latest ?? null, now);
  } catch {
    // total silence: a background check never disrupts a command
  }
};
