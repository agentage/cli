import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAuth,
  ensureConfigDir,
  getConfigDir,
  mutateAuth,
  readAuth,
  saveAuth,
  type AuthState,
} from './config.js';

const sample: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'client-1',
  tokens: { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 },
};

describe('config store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-test-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the config dir from the env override', () => {
    expect(getConfigDir()).toBe(join(dir, 'cfg'));
  });

  it('round-trips auth state and restricts file permissions', () => {
    expect(readAuth()).toBeNull();
    saveAuth(sample);
    expect(readAuth()).toEqual(sample);
    const mode = statSync(join(getConfigDir(), 'auth.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // Per-save unique tmp names make cross-process tmp clobbering structurally impossible.
  it('writes atomically, leaving no temp file behind', () => {
    for (let i = 0; i < 25; i++) saveAuth({ ...sample, clientId: `client-${i}` });
    expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(readAuth()?.clientId).toBe('client-24');
    expect(statSync(join(getConfigDir(), 'auth.json')).mode & 0o777).toBe(0o600);
  });

  it('returns null for corrupt auth files', () => {
    ensureConfigDir();
    writeFileSync(join(getConfigDir(), 'auth.json'), 'not json');
    expect(readAuth()).toBeNull();
  });

  it('deletes auth state idempotently', () => {
    saveAuth(sample);
    deleteAuth();
    deleteAuth();
    expect(readAuth()).toBeNull();
  });

  it('writes auth.json without an existing config dir', () => {
    saveAuth(sample);
    expect(JSON.parse(readFileSync(join(getConfigDir(), 'auth.json'), 'utf-8'))).toEqual(sample);
  });

  describe('mutateAuth (cross-process locked read-modify-write)', () => {
    it('writes a brand-new state and returns it', async () => {
      const next = await mutateAuth(() => sample);
      expect(next).toEqual(sample);
      expect(readAuth()).toEqual(sample);
    });

    it('folds a change onto the freshly-read on-disk state', async () => {
      saveAuth(sample);
      await mutateAuth((current) => {
        current!.tokens.accessToken = 'rotated';
        return current;
      });
      expect(readAuth()?.tokens.accessToken).toBe('rotated');
      expect(readAuth()?.clientId).toBe('client-1'); // untouched fields preserved
    });

    it('does not resurrect a signed-out file when fn returns void on a null read', async () => {
      const result = await mutateAuth((current) => {
        if (!current) return;
        current.clientId = 'x';
        return current;
      });
      expect(result).toBeNull();
      expect(readAuth()).toBeNull();
    });

    it('folds 20 concurrent token rotations without losing the write', async () => {
      saveAuth(sample);
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          mutateAuth((current) => {
            current!.tokens.accessToken = `at-${i}`;
            return current;
          })
        )
      );
      expect(readAuth()?.tokens.accessToken).toMatch(/^at-\d+$/); // one clean winner, valid state
      expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.lock'))).toEqual([]);
    });

    it('releases the lock and leaves no lockfile when fn throws', async () => {
      ensureConfigDir();
      await expect(
        mutateAuth(() => {
          throw new Error('nope');
        })
      ).rejects.toThrow('nope');
      expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.lock'))).toEqual([]);
    });
  });
});
