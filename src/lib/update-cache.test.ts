import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfigDir } from './config.js';
import { refreshUpdateCache, updateHint, type UpdateCache } from './update-cache.js';
import { type CliLatest } from './update-check.js';
import { VERSION } from '../utils/version.js';

const cacheFile = (): string => join(getConfigDir(), 'update-check.json');

const writeCache = (c: UpdateCache): void => {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(c), 'utf-8');
};

const latest = (version: string): CliLatest => ({ version, minSupported: '0.0.0', message: null });

describe('update cache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-updcache-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  describe('updateHint', () => {
    it('prints a hint only when the cached latest is newer', () => {
      writeCache({ checkedAt: Date.now(), latest: '99.0.0' });
      expect(updateHint()).toContain('99.0.0');
      expect(updateHint()).toContain('npm i -g @agentage/cli');
    });

    it('is silent when the cached latest is not newer', () => {
      writeCache({ checkedAt: Date.now(), latest: VERSION });
      expect(updateHint()).toBeNull();
    });

    it('is silent when there is no cache', () => {
      expect(updateHint()).toBeNull();
    });
  });

  describe('refreshUpdateCache', () => {
    const fresh: UpdateCache = { checkedAt: 1_000_000, latest: '0.0.1' };

    it('does not fetch when the cache is fresh (TTL respected)', async () => {
      const fetch = vi.fn(async () => latest('9.9.9'));
      const write = vi.fn();
      await refreshUpdateCache({ now: () => 1_000_000 + 60_000, read: () => fresh, fetch, write });
      expect(fetch).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it('refreshes when the cache is stale', async () => {
      const now = 1_000_000 + 2 * 60 * 60 * 1000; // 2h later
      const fetch = vi.fn(async () => latest('9.9.9'));
      const write = vi.fn();
      await refreshUpdateCache({ now: () => now, read: () => fresh, fetch, write });
      expect(fetch).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith('9.9.9', now);
    });

    it('refreshes when there is no cache', async () => {
      const fetch = vi.fn(async () => latest('9.9.9'));
      const write = vi.fn();
      await refreshUpdateCache({ now: () => 5, read: () => null, fetch, write });
      expect(fetch).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith('9.9.9', 5);
    });

    it('is silent and writes nothing when the fetch throws', async () => {
      const write = vi.fn();
      await expect(
        refreshUpdateCache({
          now: () => 5,
          read: () => null,
          fetch: async () => {
            throw new Error('net');
          },
          write,
        })
      ).resolves.toBeUndefined();
      expect(write).not.toHaveBeenCalled();
    });

    it('writes nothing when the registry is unreachable (null)', async () => {
      const write = vi.fn();
      await refreshUpdateCache({ now: () => 5, read: () => null, fetch: async () => null, write });
      expect(write).not.toHaveBeenCalled();
    });

    it('persists a fetched version to the cache file end to end', async () => {
      await refreshUpdateCache({ read: () => null, fetch: async () => latest('9.9.9') });
      const cache = JSON.parse(readFileSync(cacheFile(), 'utf-8')) as UpdateCache;
      expect(cache.latest).toBe('9.9.9');
      expect(typeof cache.checkedAt).toBe('number');
      expect(updateHint()).toContain('9.9.9');
    });
  });
});
