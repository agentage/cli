import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAuth, saveAuth, deleteAuth, type AuthState } from './auth.js';

describe('Auth', () => {
  let tempDir: string;
  const originalEnv = process.env['AGENTAGE_CONFIG_DIR'];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentage-auth-test-'));
    process.env['AGENTAGE_CONFIG_DIR'] = tempDir;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env['AGENTAGE_CONFIG_DIR'] = originalEnv;
    } else {
      delete process.env['AGENTAGE_CONFIG_DIR'];
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const testAuth: AuthState = {
    session: {
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      expires_at: Date.now() + 3600000,
    },
    user: { id: 'user-1', email: 'test@test.com' },
    hub: { url: 'https://hub.test', machineId: 'machine-1' },
  };

  test('readAuth returns null when no file', () => {
    expect(readAuth()).toBeNull();
  });

  test('saveAuth writes and readAuth reads back', () => {
    saveAuth(testAuth);
    const result = readAuth();
    expect(result).toEqual(testAuth);
  });

  test('deleteAuth removes file', () => {
    saveAuth(testAuth);
    expect(readAuth()).not.toBeNull();
    deleteAuth();
    expect(readAuth()).toBeNull();
  });

  test('deleteAuth is safe when no file', () => {
    expect(() => deleteAuth()).not.toThrow();
  });
});
