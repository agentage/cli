import { describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '../lib/update-check.js';
import { restartDaemonIfRunning, runUpdate, type UpdateDeps } from './update.js';

const makeDeps = (status: UpdateInfo['status'], over: Partial<UpdateDeps> = {}) => {
  const logs: string[] = [];
  const install = over.install ?? vi.fn(async () => {});
  const restartDaemon = over.restartDaemon ?? vi.fn(async () => false);
  const releaseLock = over.releaseLock ?? vi.fn(() => {});
  const deps: UpdateDeps = {
    check: async () => ({ status, message: null }),
    install,
    restartDaemon,
    acquireLock: over.acquireLock ?? (() => true),
    releaseLock,
    log: (m) => logs.push(m),
  };
  return { deps, logs, install, restartDaemon, releaseLock };
};

describe('update', () => {
  it('installs (and releases the lock) when an update is available', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' });
    await runUpdate({}, h.deps);
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.logs.join()).toContain('Updated');
    expect(h.releaseLock).toHaveBeenCalledOnce();
  });

  it('installs when the running version is unsupported', async () => {
    const h = makeDeps({ kind: 'unsupported', latest: '0.0.9', minSupported: '0.0.5' });
    await runUpdate({}, h.deps);
    expect(h.install).toHaveBeenCalledOnce();
  });

  it('does not install when already current', async () => {
    const h = makeDeps({ kind: 'current' });
    await runUpdate({}, h.deps);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.logs.join()).toContain('latest');
  });

  it('does not install when the registry is unreachable', async () => {
    const h = makeDeps({ kind: 'unknown' });
    await runUpdate({}, h.deps);
    expect(h.install).not.toHaveBeenCalled();
  });

  it('--check reports without installing, even when behind', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' });
    await runUpdate({ check: true }, h.deps);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.logs.join()).toContain('Update available');
  });

  it('restarts the daemon after installing when it was running', async () => {
    const h = makeDeps(
      { kind: 'update-available', latest: '0.0.9' },
      { restartDaemon: vi.fn(async () => true) }
    );
    await runUpdate({}, h.deps);
    expect(h.restartDaemon).toHaveBeenCalledOnce();
    expect(h.logs.join()).toContain('Restarted the daemon');
  });

  it('does not announce a restart when the daemon was not running', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' });
    await runUpdate({}, h.deps);
    expect(h.restartDaemon).toHaveBeenCalledOnce();
    expect(h.logs.join()).not.toContain('Restarted the daemon');
  });

  it('refuses to install when another update holds the lock', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' }, { acquireLock: () => false });
    await runUpdate({}, h.deps);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.logs.join()).toContain('in progress');
    expect(h.releaseLock).not.toHaveBeenCalled();
  });
});

describe('restartDaemonIfRunning', () => {
  it('stops and starts the daemon only when it is running', async () => {
    const stop = vi.fn(() => true);
    const start = vi.fn(async () => true);
    expect(await restartDaemonIfRunning({ running: () => true, stop, start })).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it('is a no-op when the daemon is not running', async () => {
    const stop = vi.fn(() => true);
    const start = vi.fn(async () => true);
    expect(await restartDaemonIfRunning({ running: () => false, stop, start })).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
