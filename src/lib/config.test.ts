import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAuth,
  ensureConfigDir,
  getConfigDir,
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

  it('writes atomically, leaving no temp file behind', () => {
    saveAuth(sample);
    saveAuth({ ...sample, clientId: 'client-2' });
    expect(existsSync(join(getConfigDir(), 'auth.json.tmp'))).toBe(false);
    expect(readAuth()?.clientId).toBe('client-2');
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
});
