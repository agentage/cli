import { describe, expect, it } from 'vitest';
import { VaultsConfig } from '../lib/vaults.schema.js';
import { runVaultAdd, runVaultList, runVaultRemove, type VaultDeps } from './vault.js';

const makeDeps = (initial: VaultsConfig = VaultsConfig.parse({ version: 1 })) => {
  let config = initial;
  const logs: string[] = [];
  const ensured: string[] = [];
  const removedIndex: string[] = [];
  const deps: VaultDeps = {
    load: () => ({ config, source: null }),
    save: (c) => {
      config = c;
      return '/tmp/vaults.json';
    },
    ensureDir: (p) => ensured.push(p),
    removeIndex: (n) => removedIndex.push(n),
    log: (m) => logs.push(m),
  };
  return { deps, logs, ensured, removedIndex, get: () => config };
};

describe('vault add', () => {
  it('registers a --local vault, creates its dir, saves', () => {
    const h = makeDeps();
    runVaultAdd('scratch', { local: true, path: '/tmp/scratch' }, h.deps);
    expect(h.get().vaults).toMatchObject([
      { name: 'scratch', type: 'local', path: '/tmp/scratch' },
    ]);
    expect(h.ensured).toEqual(['/tmp/scratch']);
    expect(h.logs.join()).toContain("Added vault 'scratch'");
  });

  it('registers a --git vault with a remote + interval', () => {
    const h = makeDeps();
    runVaultAdd(
      'work',
      { git: 'git@github.com:me/w.git', interval: '10m', path: '/tmp/w' },
      h.deps
    );
    expect(h.get().vaults[0]).toMatchObject({
      type: 'git',
      remote: 'git@github.com:me/w.git',
      sync: { interval: '10m' },
    });
  });

  it('defaults the path to ~/vaults/<name>', () => {
    const h = makeDeps();
    runVaultAdd('notes', { local: true }, h.deps);
    expect(h.ensured).toEqual(['~/vaults/notes']);
    expect(h.get().vaults[0]).toMatchObject({ path: '~/vaults/notes' });
  });

  it('rejects the couchdb default (no flag) as needing provisioning', () => {
    const h = makeDeps();
    expect(() => runVaultAdd('acct', {}, h.deps)).toThrow(/provisioning/);
  });

  it('rejects --local and --git together', () => {
    const h = makeDeps();
    expect(() => runVaultAdd('x', { local: true, git: 'g' }, h.deps)).toThrow(/one of/);
  });

  it('rejects a duplicate name', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: true, path: '/tmp/a' }, h.deps);
    expect(() => runVaultAdd('a', { local: true, path: '/tmp/a2' }, h.deps)).toThrow(
      /already exists/
    );
  });
});

describe('vault remove', () => {
  it('removes the vault, drops its index, keeps files', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: true, path: '/tmp/a' }, h.deps);
    runVaultRemove('a', h.deps);
    expect(h.get().vaults).toHaveLength(0);
    expect(h.removedIndex).toEqual(['a']);
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

  it('prints one line per vault', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: true, path: '/tmp/a' }, h.deps);
    runVaultAdd('b', { git: 'g@h:x.git', path: '/tmp/b' }, h.deps);
    h.logs.length = 0;
    runVaultList({}, h.deps);
    expect(h.logs).toHaveLength(2);
  });

  it('emits JSON with --json', () => {
    const h = makeDeps();
    runVaultAdd('a', { local: true, path: '/tmp/a' }, h.deps);
    h.logs.length = 0;
    runVaultList({ json: true }, h.deps);
    expect(JSON.parse(h.logs[0] ?? '[]')).toHaveLength(1);
  });
});
