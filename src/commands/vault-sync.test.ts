import { describe, expect, it, vi } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import { type SyncResult } from '../sync/cycle.js';
import { type SyncTarget } from '../sync/planner.js';
import { runVaultSync, type VaultSyncDeps } from './vault-sync.js';

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  vault: 'v',
  remote: 'git@h:v.git',
  ok: true,
  committed: false,
  pushed: true,
  conflicts: [],
  ...over,
});

const makeDeps = (over: Partial<VaultSyncDeps> = {}): { deps: VaultSyncDeps; logs: string[] } => {
  const logs: string[] = [];
  const deps: VaultSyncDeps = {
    loadConfig: (): VaultsConfig => ({
      version: 1,
      vaults: { v: { path: '/tmp/v', origin: [{ remote: 'git@h:v.git', interval: 0 }] } },
    }),
    daemonPort: async () => null,
    runViaDaemon: async () => result(),
    runInProcess: async () => result(),
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, logs };
};

describe('runVaultSync', () => {
  it('reports "no git origin" for an unknown vault name', async () => {
    const { deps, logs } = makeDeps();
    await runVaultSync('missing', deps);
    expect(logs.join()).toContain("No git origin configured for vault 'missing'");
  });

  it('hints when no git-synced vaults exist', async () => {
    const { deps, logs } = makeDeps({ loadConfig: () => ({ version: 1, vaults: {} }) });
    await runVaultSync(undefined, deps);
    expect(logs.join()).toContain('No git-synced vaults');
  });

  it('runs in-process when the daemon is down', async () => {
    const runInProcess = vi.fn(async (_t: SyncTarget) => result({ committed: true }));
    const { deps, logs } = makeDeps({ daemonPort: async () => null, runInProcess });
    await runVaultSync('v', deps);
    expect(runInProcess).toHaveBeenCalledTimes(1);
    expect(logs.join()).toContain('committed');
    expect(logs.join()).toContain('pushed');
  });

  it('delegates to the daemon when one is reachable', async () => {
    const runViaDaemon = vi.fn(async () => result());
    const runInProcess = vi.fn(async (t: SyncTarget) => result({ vault: t.vault }));
    const { deps } = makeDeps({ daemonPort: async () => 4243, runViaDaemon, runInProcess });
    await runVaultSync('v', deps);
    expect(runViaDaemon).toHaveBeenCalledWith(4243, 'v');
    expect(runInProcess).not.toHaveBeenCalled();
  });

  it('surfaces a failure line and lists preserved conflict copies', async () => {
    const { deps, logs } = makeDeps({
      runInProcess: async () =>
        result({ ok: false, pushed: false, reason: 'unreachable', error: 'nope' }),
    });
    await runVaultSync('v', deps);
    expect(logs.join()).toContain('failed (unreachable)');

    const { deps: d2, logs: l2 } = makeDeps({
      runInProcess: async () => result({ conflicts: ['note.conflict.md'] }),
    });
    await runVaultSync('v', d2);
    expect(l2.join()).toContain('kept remote copy: note.conflict.md');
  });
});
