import { describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import { runVaultAdd, runVaultList, runVaultRemove, type VaultDeps } from './vault.js';

const makeDeps = (initial: VaultsConfig = { version: 1, vaults: {} }) => {
  let config = initial;
  const logs: string[] = [];
  const ensured: string[] = [];
  const deps: VaultDeps = {
    load: () => ({ config, source: null }),
    save: (c) => {
      config = c;
      return '/tmp/vaults.json';
    },
    ensureDir: (p) => ensured.push(p),
    log: (m) => logs.push(m),
  };
  return { deps, logs, ensured, get: () => config };
};

describe('vault add', () => {
  it('registers a --local vault, creates its dir, sets the default', () => {
    const h = makeDeps();
    runVaultAdd('scratch', { local: '/tmp/scratch' }, h.deps);
    expect(h.get().vaults?.scratch).toEqual({ path: '/tmp/scratch', mcp: ['local'] });
    expect(h.get().default).toBe('scratch');
    expect(h.ensured).toEqual(['/tmp/scratch']);
    expect(h.logs.join()).toContain("Added vault 'scratch'");
  });

  it('defaults the --local path to ~/vaults/<name> when no value is given', () => {
    const h = makeDeps();
    runVaultAdd('notes', { local: true }, h.deps);
    expect(h.get().vaults?.notes).toMatchObject({ path: '~/vaults/notes' });
    expect(h.ensured).toEqual(['~/vaults/notes']);
  });

  it('registers a --git vault as an origin (no dir created)', () => {
    const h = makeDeps();
    runVaultAdd('work', { git: 'git@github.com:me/w.git' }, h.deps);
    expect(h.get().vaults?.work.origin?.[0]?.remote).toBe('git@github.com:me/w.git');
    expect(h.ensured).toEqual([]);
  });

  it('rejects add with no flag', () => {
    const h = makeDeps();
    expect(() => runVaultAdd('acct', {}, h.deps)).toThrow(/--local .* --git/);
  });

  it('rejects --local and --git together', () => {
    const h = makeDeps();
    expect(() => runVaultAdd('x', { local: true, git: 'g' }, h.deps)).toThrow(/one of/);
  });

  it('rejects a duplicate name', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    expect(() => runVaultAdd('a', { local: '/tmp/a2' }, h.deps)).toThrow(/already exists/);
  });
});

describe('vault remove', () => {
  it('removes the vault and reassigns the default', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    runVaultAdd('b', { local: '/tmp/b' }, h.deps);
    h.logs.length = 0;
    runVaultRemove('a', h.deps);
    expect(Object.keys(h.get().vaults ?? {})).toEqual(['b']);
    expect(h.get().default).toBe('b');
    expect(h.logs.join()).toContain("Default vault is now 'b'");
  });

  it('throws when the vault is absent', () => {
    const h = makeDeps();
    expect(() => runVaultRemove('nope', h.deps)).toThrow(/not found/);
  });
});

describe('vault list', () => {
  it('prints a friendly hint when empty', () => {
    const h = makeDeps();
    runVaultList({}, h.deps);
    expect(h.logs.join()).toContain('No vaults registered');
  });

  it('prints one line per vault and marks the default', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    runVaultAdd('b', { git: 'g@h:x.git' }, h.deps);
    h.logs.length = 0;
    runVaultList({}, h.deps);
    expect(h.logs).toHaveLength(2);
    expect(h.logs[0]).toContain('(default)');
  });

  it('emits the vaults map with --json', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: '/tmp/a' }, h.deps);
    h.logs.length = 0;
    runVaultList({ json: true }, h.deps);
    expect(Object.keys(JSON.parse(h.logs[0] ?? '{}'))).toEqual(['a']);
  });
});
