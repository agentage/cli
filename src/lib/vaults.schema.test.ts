import { describe, expect, it } from 'vitest';
import { Discover, Vault, VaultsConfig } from './vaults.schema.js';

describe('Vault schema', () => {
  it('accepts a local vault (no sync block)', () => {
    const v = Vault.parse({ name: 'scratch', type: 'local', path: '~/vaults/scratch' });
    expect(v).toEqual({ name: 'scratch', type: 'local', path: '~/vaults/scratch' });
  });

  it('defaults a couchdb vault to server agentage + continuous sync', () => {
    const v = Vault.parse({ name: 'default', type: 'couchdb', path: '~/vaults/default' });
    expect(v).toMatchObject({
      type: 'couchdb',
      server: 'agentage',
      sync: { auto: true, mode: 'continuous', ignore: ['.obsidian/', 'data.json'] },
    });
  });

  it('defaults a git vault sync block and requires a remote', () => {
    const v = Vault.parse({
      name: 'work',
      type: 'git',
      path: '~/vaults/work',
      remote: 'git@github.com:me/work.git',
    });
    expect(v).toMatchObject({ sync: { interval: '5m', message: 'vault: auto-sync', auto: true } });
    expect(() => Vault.parse({ name: 'work', type: 'git', path: '~/w' })).toThrow();
  });

  it('setting ignore replaces the defaults ([] = sync everything)', () => {
    const v = Vault.parse({
      name: 'work',
      type: 'couchdb',
      path: '~/w',
      sync: { ignore: [] },
    });
    expect(v).toMatchObject({ sync: { ignore: [] } });
  });

  it('hard-fails an unknown type', () => {
    expect(() => Vault.parse({ name: 'x', type: 'ftp', path: '~/x' })).toThrow();
  });

  it('rejects a name that breaks the cloud-path allowlist', () => {
    expect(() => Vault.parse({ name: 'has spaces', type: 'local', path: '~/x' })).toThrow();
    expect(() => Vault.parse({ name: 'a/b', type: 'local', path: '~/x' })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => Vault.parse({ name: 'x', type: 'local', path: '~/x', mcp: ['local'] })).toThrow();
  });
});

describe('Discover schema', () => {
  it('defaults type couchdb, autosync on, dot/underscore ignores', () => {
    expect(Discover.parse({ path: '~/vaults' })).toEqual({
      path: '~/vaults',
      type: 'couchdb',
      autosync: true,
      ignore: ['.*', '_*'],
    });
  });
});

describe('VaultsConfig schema', () => {
  it('defaults empty discover + vaults arrays', () => {
    expect(VaultsConfig.parse({ version: 1 })).toEqual({ version: 1, discover: [], vaults: [] });
  });

  it('accepts and ignores $schema', () => {
    const c = VaultsConfig.parse({ $schema: 'https://x/y.json', version: 1 });
    expect(c.version).toBe(1);
  });

  it('rejects a version other than 1', () => {
    expect(() => VaultsConfig.parse({ version: 2 })).toThrow();
  });

  it('rejects duplicate vault names', () => {
    expect(() =>
      VaultsConfig.parse({
        version: 1,
        vaults: [
          { name: 'dup', type: 'local', path: '~/a' },
          { name: 'dup', type: 'local', path: '~/b' },
        ],
      })
    ).toThrow(/duplicate vault name/);
  });
});
