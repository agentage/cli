import { describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import { type ProvisionResult } from '../lib/provision.js';
import { runVaultAdd, runVaultList, runVaultRemove, type VaultDeps } from './vault.js';

const makeDeps = (
  initial: VaultsConfig = { version: 1, vaults: {} },
  provision: ProvisionResult = { status: 'provisioned', message: "Provisioned account vault 'x'." }
) => {
  let config = initial;
  const logs: string[] = [];
  const ensured: string[] = [];
  const provisioned: string[] = [];
  const deps: VaultDeps = {
    load: () => ({ config, source: null }),
    save: (c) => {
      config = c;
      return '/tmp/vaults.json';
    },
    ensureDir: (p) => ensured.push(p),
    provision: async (name) => {
      provisioned.push(name);
      return provision;
    },
    log: (m) => logs.push(m),
  };
  return { deps, logs, ensured, provisioned, get: () => config };
};

describe('vault add', () => {
  it('registers a --local vault, creates its dir, sets the default', async () => {
    const h = makeDeps();
    await runVaultAdd('scratch', { local: '/tmp/scratch' }, h.deps);
    expect(h.get().vaults?.scratch).toEqual({ path: '/tmp/scratch', mcp: ['local'] });
    expect(h.get().default).toBe('scratch');
    expect(h.ensured).toEqual(['/tmp/scratch']);
    expect(h.provisioned).toEqual([]);
    expect(h.logs.join()).toContain("Added vault 'scratch'");
  });

  it('defaults the --local path to ~/vaults/<name> when no value is given', async () => {
    const h = makeDeps();
    await runVaultAdd('notes', { local: true }, h.deps);
    expect(h.get().vaults?.notes).toMatchObject({ path: '~/vaults/notes' });
    expect(h.ensured).toEqual(['~/vaults/notes']);
  });

  it('registers a --git vault as a local working copy synced to an origin', async () => {
    const h = makeDeps();
    await runVaultAdd('work', { git: 'git@github.com:me/w.git' }, h.deps);
    expect(h.get().vaults?.work).toEqual({
      path: '~/vaults/work',
      origin: [{ remote: 'git@github.com:me/w.git' }],
      mcp: ['local'],
    });
    // The working copy dir is created so the daemon has somewhere to commit/push from.
    expect(h.ensured).toEqual(['~/vaults/work']);
    expect(h.provisioned).toEqual([]);
    expect(h.logs.join()).toContain('(git)');
  });

  it('with no flag registers an account vault, writes the entry, then provisions', async () => {
    const h = makeDeps();
    await runVaultAdd('acct', {}, h.deps);
    // The local entry is written (path + agentage origin) before provisioning is attempted.
    expect(h.get().vaults?.acct).toEqual({
      path: '~/vaults/acct',
      origin: [{ remote: 'agentage' }],
    });
    expect(h.get().default).toBe('acct');
    expect(h.ensured).toEqual(['~/vaults/acct']);
    expect(h.provisioned).toEqual(['acct']);
    expect(h.logs.join()).toContain('(account)');
    expect(h.logs.join()).toContain("Provisioned account vault 'x'.");
  });

  it('an account vault honors --path for its local mirror dir', async () => {
    const h = makeDeps();
    await runVaultAdd('acct', { path: '/data/acct' }, h.deps);
    expect(h.get().vaults?.acct).toEqual({
      path: '/data/acct',
      origin: [{ remote: 'agentage' }],
    });
    expect(h.ensured).toEqual(['/data/acct']);
  });

  it('surfaces the provisioning message even when the channel is disabled', async () => {
    const h = makeDeps(
      { version: 1, vaults: {} },
      {
        status: 'disabled',
        message: "Vault 'acct' registered locally. Account sync is not enabled.",
      }
    );
    await runVaultAdd('acct', {}, h.deps);
    // Provisioning is never fatal: the entry stands and the calm one-liner is printed.
    expect(h.get().vaults?.acct).toBeDefined();
    expect(h.logs.join()).toContain('Account sync is not enabled');
  });

  it('rejects --path combined with --local/--git', async () => {
    const h = makeDeps();
    await expect(runVaultAdd('x', { path: '/p', local: true }, h.deps)).rejects.toThrow(/--path/);
  });

  it('rejects --local and --git together', async () => {
    const h = makeDeps();
    await expect(runVaultAdd('x', { local: true, git: 'g' }, h.deps)).rejects.toThrow(/one of/);
  });

  it('rejects a duplicate name', async () => {
    const h = makeDeps();
    await runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    await expect(runVaultAdd('a', { local: '/tmp/a2' }, h.deps)).rejects.toThrow(/already exists/);
  });

  it('rejects an invalid name', async () => {
    const h = makeDeps();
    await expect(runVaultAdd('bad name', {}, h.deps)).rejects.toThrow(/invalid vault name/);
  });
});

describe('vault remove', () => {
  it('removes the vault and reassigns the default', async () => {
    const h = makeDeps();
    await runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    await runVaultAdd('b', { local: '/tmp/b' }, h.deps);
    h.logs.length = 0;
    runVaultRemove('a', h.deps);
    expect(Object.keys(h.get().vaults ?? {})).toEqual(['b']);
    expect(h.get().default).toBe('b');
    expect(h.logs.join()).toContain("Default vault is now 'b'");
  });

  it('removes an account vault without touching any server', async () => {
    const h = makeDeps();
    await runVaultAdd('acct', {}, h.deps);
    h.logs.length = 0;
    h.provisioned.length = 0;
    runVaultRemove('acct', h.deps);
    expect(h.get().vaults).toEqual({});
    // Remove is purely local: it never re-enters the provisioning path.
    expect(h.provisioned).toEqual([]);
    expect(h.logs.join()).toContain('files left on disk');
  });

  it('throws when the vault is absent', () => {
    const h = makeDeps();
    expect(() => runVaultRemove('nope', h.deps)).toThrow(/not found/);
  });

  it('appends the name to the discover-root ignore when the path sits under it', () => {
    const h = makeDeps({
      version: 1,
      discover: [{ path: '/data/roots' }],
      vaults: { teamnotes: { path: '/data/roots/teamnotes', origin: [{ remote: 'agentage' }] } },
    });
    runVaultRemove('teamnotes', h.deps);
    expect(h.get().vaults).toEqual({});
    expect(h.get().discover?.[0]?.ignore).toEqual(['teamnotes']);
    expect(h.logs.join()).toContain('/data/roots ignore');
  });

  it('leaves the discover config untouched for a vault outside every root', () => {
    const h = makeDeps({
      version: 1,
      discover: [{ path: '/data/roots' }],
      vaults: { work: { path: '/elsewhere/work', mcp: ['local'] } },
    });
    runVaultRemove('work', h.deps);
    expect(h.get().discover?.[0]?.ignore).toBeUndefined();
    expect(h.logs.join()).not.toContain('ignore');
  });
});

describe('vault list', () => {
  it('prints a friendly hint when empty', () => {
    const h = makeDeps();
    runVaultList({}, h.deps);
    expect(h.logs.join()).toContain('No vaults registered');
  });

  it('prints one line per vault and marks the default', async () => {
    const h = makeDeps();
    await runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    await runVaultAdd('b', { git: 'g@h:x.git' }, h.deps);
    h.logs.length = 0;
    runVaultList({}, h.deps);
    expect(h.logs).toHaveLength(2);
    expect(h.logs[0]).toContain('(default)');
  });

  it('emits the vaults map with --json, annotating an honest type', async () => {
    const h = makeDeps();
    await runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    await runVaultAdd('acct', {}, h.deps);
    h.logs.length = 0;
    runVaultList({ json: true }, h.deps);
    const out = JSON.parse(h.logs[0] ?? '{}') as Record<string, { path?: string; type?: string }>;
    expect(Object.keys(out)).toEqual(['a', 'acct']);
    // Backward-compatible: entries keep their fields; type is added on top.
    expect(out.a!.path).toBe('/tmp/a');
    expect(out.a!.type).toBe('local');
    expect(out.acct!.type).toBe('account');
  });
});
