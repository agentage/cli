import { readFileSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { join } from 'node:path';
import { ensureConfigDir, getConfigDir } from './config.js';
import { compareVersions, INSTALL_HINT, REGISTRY_URL } from './update-check.js';
import { VERSION } from '../utils/version.js';

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

// node:https instead of global fetch: undici keeps a ref'd ~10s connect timer alive even after
// its AbortSignal fires, stalling process exit on an unreachable network. req.destroy() from an
// unref'd timer caps the whole attempt and frees the event loop the moment it settles.
export const fetchLatestVersion = (
  timeoutMs: number,
  url: string = REGISTRY_URL
): Promise<string | null> =>
  new Promise((resolve) => {
    const req = get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const v = (JSON.parse(body) as { version?: unknown }).version;
          resolve(typeof v === 'string' ? v : null);
        } catch {
          resolve(null);
        }
      });
    });
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    timer.unref();
    req.once('error', () => resolve(null));
    req.once('close', () => {
      clearTimeout(timer);
      resolve(null); // no-op when already resolved
    });
  });

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
