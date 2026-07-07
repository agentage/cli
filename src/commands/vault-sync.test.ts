import { describe, expect, it, vi } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import { type SyncResult } from '../sync/cycle.js';
import { type CouchSyncResult } from '../sync/couch/manager.js';
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

const couchResult = (over: Partial<CouchSyncResult> = {}): CouchSyncResult => ({
  vault: 'acct',
  channel: 'couch',
  ok: true,
  committed: false,
  pulled: false,
  pendingCount: 0,
  ...over,
});

const gitConfig = (): VaultsConfig => ({
  version: 1,
  vaults: { v: { path: '/tmp/v', origin: [{ remote: 'git@h:v.git', interval: 0 }] } },
});

const acctConfig = (): VaultsConfig => ({
  version: 1,
  vaults: { acct: { path: '/tmp/acct', origin: [{ remote: 'agentage' }] } },
});

const makeDeps = (over: Partial<VaultSyncDeps> = {}): { deps: VaultSyncDeps; logs: string[] } => {
  const logs: string[] = [];
  const deps: VaultSyncDeps = {
    loadConfig: gitConfig,
    daemonPort: async () => null,
    runViaDaemon: async () => result(),
    runGitInProcess: async () => result(),
    runCouchInProcess: async () => couchResult(),
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, logs };
};

describe('runVaultSync', () => {
  it('errors when the named vault is not registered', async () => {
    const { deps } = makeDeps();
    await expect(runVaultSync('missing', deps)).rejects.toThrow("vault 'missing' not found");
  });

  it('reports "no syncable origin" for a registered vault with no external origin', async () => {
    const { deps, logs } = makeDeps({
      loadConfig: () => ({ version: 1, vaults: { local: { path: '/tmp/local' } } }),
    });
    await runVaultSync('local', deps);
    expect(logs.join()).toContain("No syncable origin configured for vault 'local'");
  });

  it('prints an upfront count and a per-vault progress line', async () => {
    const { deps, logs } = makeDeps({ daemonPort: async () => null });
    await runVaultSync('v', deps);
    expect(logs).toContain('Syncing 1 vault(s)...');
    expect(logs).toContain('v...');
  });

  it('hints when no syncable vaults exist', async () => {
    const { deps, logs } = makeDeps({ loadConfig: () => ({ version: 1, vaults: {} }) });
    await runVaultSync(undefined, deps);
    expect(logs.join()).toContain('No syncable vaults');
  });

  it('runs an account vault in-process over the couch channel', async () => {
    const runCouchInProcess = vi.fn(async () => couchResult({ committed: true, pulled: true }));
    const runGitInProcess = vi.fn(async (_t: SyncTarget) => result());
    const { deps, logs } = makeDeps({
      loadConfig: acctConfig,
      daemonPort: async () => null,
      runCouchInProcess,
      runGitInProcess,
    });
    await runVaultSync('acct', deps);
    expect(runCouchInProcess).toHaveBeenCalledWith('acct');
    expect(runGitInProcess).not.toHaveBeenCalled();
    expect(logs.join()).toContain('acct (account): ');
    expect(logs.join()).toContain('committed');
    expect(logs.join()).toContain('pulled');
  });

  it('renders a paused account vault clearly', async () => {
    const { deps, logs } = makeDeps({
      loadConfig: acctConfig,
      daemonPort: async () => null,
      runCouchInProcess: async () => couchResult({ paused: 'signed out' }),
    });
    await runVaultSync('acct', deps);
    expect(logs.join()).toContain('paused (signed out)');
  });

  it('delegates an account vault to the daemon when one is reachable', async () => {
    const runViaDaemon = vi.fn(async () => couchResult());
    const runCouchInProcess = vi.fn(async () => couchResult());
    const { deps } = makeDeps({
      loadConfig: acctConfig,
      daemonPort: async () => 4243,
      runViaDaemon,
      runCouchInProcess,
    });
    await runVaultSync('acct', deps);
    expect(runViaDaemon).toHaveBeenCalledWith(4243, 'acct');
    expect(runCouchInProcess).not.toHaveBeenCalled();
  });

  it('runs a git vault in-process when the daemon is down', async () => {
    const runGitInProcess = vi.fn(async (_t: SyncTarget) => result({ committed: true }));
    const { deps, logs } = makeDeps({ daemonPort: async () => null, runGitInProcess });
    await runVaultSync('v', deps);
    expect(runGitInProcess).toHaveBeenCalledTimes(1);
    expect(logs.join()).toContain('committed');
    expect(logs.join()).toContain('pushed');
  });

  it('delegates a git vault to the daemon when one is reachable', async () => {
    const runViaDaemon = vi.fn(async () => result());
    const runGitInProcess = vi.fn(async (t: SyncTarget) => result({ vault: t.vault }));
    const { deps } = makeDeps({ daemonPort: async () => 4243, runViaDaemon, runGitInProcess });
    await runVaultSync('v', deps);
    expect(runViaDaemon).toHaveBeenCalledWith(4243, 'v');
    expect(runGitInProcess).not.toHaveBeenCalled();
  });

  it('surfaces a git failure line and lists preserved conflict copies', async () => {
    const { deps, logs } = makeDeps({
      runGitInProcess: async () =>
        result({ ok: false, pushed: false, reason: 'unreachable', error: 'nope' }),
    });
    await runVaultSync('v', deps);
    expect(logs.join()).toContain('failed (unreachable)');

    const { deps: d2, logs: l2 } = makeDeps({
      runGitInProcess: async () => result({ conflicts: ['note.conflict.md'] }),
    });
    await runVaultSync('v', d2);
    expect(l2.join()).toContain('kept remote copy: note.conflict.md');
  });
});
