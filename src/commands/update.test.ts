import { describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '../lib/update-check.js';
import { runUpdate, type UpdateDeps } from './update.js';

const makeDeps = (status: UpdateInfo['status']) => {
  const logs: string[] = [];
  const install = vi.fn(async () => {});
  const deps: UpdateDeps = {
    check: async () => ({ status, message: null }),
    install,
    log: (m) => logs.push(m),
  };
  return { deps, logs, install };
};

describe('update', () => {
  it('installs when an update is available', async () => {
    const h = makeDeps({ kind: 'update-available', latest: '0.0.9' });
    await runUpdate({}, h.deps);
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.logs.join()).toContain('Updated');
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
});
