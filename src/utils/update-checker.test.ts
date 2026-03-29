import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-update-${Date.now()}`);

describe('update-checker', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('compareVersions', () => {
    it('returns true when latest is newer', async () => {
      const { compareVersions } = await import('./update-checker.js');
      expect(compareVersions('0.12.3', '0.12.4')).toBe(true);
      expect(compareVersions('0.12.3', '0.13.0')).toBe(true);
      expect(compareVersions('0.12.3', '1.0.0')).toBe(true);
    });

    it('returns false when current is same or newer', async () => {
      const { compareVersions } = await import('./update-checker.js');
      expect(compareVersions('0.12.3', '0.12.3')).toBe(false);
      expect(compareVersions('0.12.4', '0.12.3')).toBe(false);
      expect(compareVersions('1.0.0', '0.99.99')).toBe(false);
    });

    it('handles v prefix', async () => {
      const { compareVersions } = await import('./update-checker.js');
      expect(compareVersions('v0.12.3', 'v0.12.4')).toBe(true);
    });
  });

  describe('checkForUpdate', () => {
    it('uses cached result within TTL', async () => {
      const cache = {
        latestVersion: '0.99.0',
        checkedAt: new Date().toISOString(),
      };
      writeFileSync(join(testDir, 'update-check.json'), JSON.stringify(cache));

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const { checkForUpdate } = await import('./update-checker.js');
      const result = await checkForUpdate();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.latestVersion).toBe('0.99.0');
      expect(result.updateAvailable).toBe(true);
    });

    it('queries npm when cache is expired', async () => {
      const cache = {
        latestVersion: '0.1.0',
        checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      };
      writeFileSync(join(testDir, 'update-check.json'), JSON.stringify(cache));

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ version: '0.99.0' }), { status: 200 })
      );

      const { checkForUpdate } = await import('./update-checker.js');
      const result = await checkForUpdate();

      expect(result.latestVersion).toBe('0.99.0');

      // Verify cache was updated
      const updatedCache = JSON.parse(readFileSync(join(testDir, 'update-check.json'), 'utf-8'));
      expect(updatedCache.latestVersion).toBe('0.99.0');
    });

    it('queries npm when forced', async () => {
      const cache = {
        latestVersion: '0.1.0',
        checkedAt: new Date().toISOString(),
      };
      writeFileSync(join(testDir, 'update-check.json'), JSON.stringify(cache));

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ version: '0.99.0' }), { status: 200 })
      );

      const { checkForUpdate } = await import('./update-checker.js');
      const result = await checkForUpdate({ force: true });

      expect(result.latestVersion).toBe('0.99.0');
    });
  });

  describe('checkForUpdateSafe', () => {
    it('returns null on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const { checkForUpdateSafe } = await import('./update-checker.js');
      const result = await checkForUpdateSafe({ force: true });

      expect(result).toBeNull();
    });
  });
});
