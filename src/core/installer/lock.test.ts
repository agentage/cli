import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireFileLock, releaseFileLock } from '../../lib/fs/file-lock.js';
import {
  INSTALL_LOCK_LIMITS,
  installLockTarget,
  withInstallLock,
  type InstallLockDeps,
} from './lock.js';

const fakeDeps = (busyFor: number, over: Partial<InstallLockDeps> = {}) => {
  let clock = 0;
  let attempts = 0;
  const deps: InstallLockDeps = {
    acquire: vi.fn(() => ++attempts > busyFor),
    release: vi.fn(),
    refresh: vi.fn(() => true),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    onWait: vi.fn(),
    limits: { ttlMs: 1000, hardStaleMs: 5000, maxWaitMs: 1000 },
    heartbeatMs: 100,
    ...over,
  };
  return { deps, tick: (ms: number) => (clock += ms) };
};

describe('withInstallLock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks <pluginsDir>/install.lock and releases it after the body', async () => {
    const { deps } = fakeDeps(0);
    await expect(withInstallLock('/p', async () => 'done', deps)).resolves.toBe('done');
    expect(installLockTarget('/p')).toBe(join('/p', 'install'));
    expect(deps.acquire).toHaveBeenCalledWith(join('/p', 'install'), 0, deps.limits);
    expect(deps.release).toHaveBeenCalledWith(join('/p', 'install'));
    expect(deps.onWait).not.toHaveBeenCalled();
  });

  it('waits while another run holds the lock, saying so once (T34)', async () => {
    const { deps } = fakeDeps(3);
    await withInstallLock('/p', async () => undefined, deps);
    expect(deps.acquire).toHaveBeenCalledTimes(4);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.onWait).toHaveBeenCalledTimes(1);
    expect(deps.onWait).toHaveBeenCalledWith(join('/p', 'install.lock'));
  });

  it('gives up after the max wait without running the body', async () => {
    const { deps } = fakeDeps(Number.POSITIVE_INFINITY);
    const body = vi.fn(async () => undefined);
    await expect(withInstallLock('/p', body, deps)).rejects.toThrow(
      `another install still holds ${join('/p', 'install')}.lock after 1000ms`
    );
    expect(body).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('refreshes the stamp on a heartbeat while the body runs, and releases on throw', async () => {
    vi.useFakeTimers();
    const { deps, tick } = fakeDeps(0);
    const body = async (): Promise<never> => {
      await vi.advanceTimersByTimeAsync(350);
      tick(350);
      throw new Error('npm failed');
    };
    await expect(withInstallLock('/p', body, deps)).rejects.toThrow('npm failed');
    expect(deps.refresh).toHaveBeenCalledTimes(3);
    expect(deps.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.refresh).toHaveBeenCalledTimes(3);
  });

  it('keeps a long TTL so a live install is never taken over', () => {
    expect(INSTALL_LOCK_LIMITS.ttlMs).toBeGreaterThanOrEqual(60_000);
    expect(INSTALL_LOCK_LIMITS.maxWaitMs).toBeGreaterThan(INSTALL_LOCK_LIMITS.ttlMs);
  });
});

describe('withInstallLock on disk', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-install-lock-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds a real install.lock with this pid during the body', async () => {
    const seen = await withInstallLock(dir, async () =>
      readFileSync(join(dir, 'install.lock'), 'utf-8')
    );
    expect(seen.split(' ')[0]).toBe(String(process.pid));
    expect(existsSync(join(dir, 'install.lock'))).toBe(false);
  });

  it('waits for a live holder with the real deps, saying so on stderr', async () => {
    const target = join(dir, 'install');
    expect(acquireFileLock(target)).toBe(true);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      setTimeout(() => releaseFileLock(target), 300);
      await expect(withInstallLock(dir, async () => 'after')).resolves.toBe('after');
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledWith(`waiting for another install to finish (${target}.lock)`);
    } finally {
      stderr.mockRestore();
    }
  });

  it('takes over a lock left by a crashed run', async () => {
    writeFileSync(join(dir, 'install.lock'), '999999 1');
    await expect(withInstallLock(dir, async () => 'mine')).resolves.toBe('mine');
  });
});
