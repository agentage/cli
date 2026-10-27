import { describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '../../lib/update/update-check.js';
import { runUpdate, type UpdateDeps } from './update.js';

const makeDeps = (status: UpdateInfo['status'], over: Partial<UpdateDeps> = {}) => {
  const logs: string[] = [];
  const install = over.install ?? vi.fn(async () => {});
  const releaseLock = over.releaseLock ?? vi.fn(() => {});
  const deps: UpdateDeps = {
    check: async () => ({ status, message: null }),
    install,
    acquireLock: over.acquireLock ?? (() => true),
    releaseLock,
    log: (m) => logs.push(m),
  };
  return { deps, logs, install, releaseLock };
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

  it('refuses to install when another update holds the lock', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' }, { acquireLock: () => false });
    await runUpdate({}, h.deps);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.logs.join()).toContain('in progress');
    expect(h.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the lock when the install throws (finally path)', async () => {
    const h = makeDeps(
      { kind: 'update-available', latest: '0.0.9' },
      {
        install: vi.fn(async () => {
          throw new Error('npm exploded');
        }),
      }
    );
    await expect(runUpdate({}, h.deps)).rejects.toThrow('npm exploded');
    expect(h.releaseLock).toHaveBeenCalledOnce();
  });
});
