import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigDir } from './config.js';
import { acquireUpdateLock, releaseUpdateLock } from './update-lock.js';

const lockFile = (): string => join(getConfigDir(), 'update.lock');

describe('update lock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-lock-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires when no lock is held', () => {
    expect(acquireUpdateLock()).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
  });

  it('refuses when a fresh lock is already held', () => {
    const now = 1_000_000;
    expect(acquireUpdateLock(now)).toBe(true);
    expect(acquireUpdateLock(now + 60_000)).toBe(false); // 1 min later, still within TTL
  });

  it('overrides a stale lock (older than the 10-minute TTL)', () => {
    const now = 1_000_000;
    expect(acquireUpdateLock(now)).toBe(true);
    expect(acquireUpdateLock(now + 11 * 60_000)).toBe(true); // 11 min later, stale
  });

  it('releases idempotently', () => {
    acquireUpdateLock();
    releaseUpdateLock();
    releaseUpdateLock();
    expect(existsSync(lockFile())).toBe(false);
  });
});
