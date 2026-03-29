import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../daemon/config.js';
import { VERSION } from './version.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@agentage/cli/latest';
const CACHE_FILE = 'update-check.json';

interface UpdateCheckCache {
  latestVersion: string;
  checkedAt: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

const getCachePath = (): string => join(getConfigDir(), CACHE_FILE);

const readCache = (): UpdateCheckCache | null => {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw) as UpdateCheckCache;
  } catch {
    return null;
  }
};

const writeCache = (latestVersion: string): void => {
  const cachePath = getCachePath();
  const data: UpdateCheckCache = {
    latestVersion,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(cachePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
};

const isCacheValid = (cache: UpdateCheckCache): boolean => {
  const checkedAt = new Date(cache.checkedAt).getTime();
  return Date.now() - checkedAt < CACHE_TTL_MS;
};

export const compareVersions = (current: string, latest: string): boolean => {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number);
  const c = parse(current);
  const l = parse(latest);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }

  return false;
};

export const fetchLatestVersion = async (): Promise<string> => {
  const response = await fetch(NPM_REGISTRY_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }

  const data = (await response.json()) as { version: string };
  return data.version;
};

export const checkForUpdate = async (
  options: { force?: boolean } = {}
): Promise<UpdateCheckResult> => {
  const currentVersion = VERSION;

  // Try cache first (unless forced)
  if (!options.force) {
    const cache = readCache();
    if (cache && isCacheValid(cache)) {
      return {
        currentVersion,
        latestVersion: cache.latestVersion,
        updateAvailable: compareVersions(currentVersion, cache.latestVersion),
      };
    }
  }

  const latestVersion = await fetchLatestVersion();
  writeCache(latestVersion);

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(currentVersion, latestVersion),
  };
};

export const checkForUpdateSafe = async (
  options: { force?: boolean } = {}
): Promise<UpdateCheckResult | null> => {
  try {
    return await checkForUpdate(options);
  } catch {
    return null;
  }
};
