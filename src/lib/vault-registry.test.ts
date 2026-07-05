import { describe, expect, it } from 'vitest';
import {
  addVault,
  expandHome,
  formatVaultLine,
  indexDbPath,
  removeVault,
} from './vault-registry.js';
import { VaultsConfig } from './vaults.schema.js';

const base = (): VaultsConfig => VaultsConfig.parse({ version: 1 });

describe('addVault', () => {
  it('appends a local vault verbatim', () => {
    const { config, vault } = addVault(base(), {
      name: 'scratch',
      type: 'local',
      path: '~/vaults/scratch',
    });
    expect(vault).toEqual({ name: 'scratch', type: 'local', path: '~/vaults/scratch' });
    expect(config.vaults).toHaveLength(1);
  });

  it('fills the git sync defaults', () => {
    const { vault } = addVault(base(), {
      name: 'work',
      type: 'git',
      path: '~/w',
      remote: 'git@github.com:me/w.git',
    });
    expect(vault).toMatchObject({
      type: 'git',
      sync: { auto: true, interval: '5m', message: 'vault: auto-sync' },
    });
  });

  it('rejects a duplicate name', () => {
    const { config } = addVault(base(), { name: 'a', type: 'local', path: '~/a' });
    expect(() => addVault(config, { name: 'a', type: 'local', path: '~/b' })).toThrow(
      /already exists/
    );
  });

  it('rejects an invalid name via the schema', () => {
    expect(() => addVault(base(), { name: 'bad name', type: 'local', path: '~/x' })).toThrow();
  });

  it('rejects a git vault with no remote', () => {
    expect(() => addVault(base(), { name: 'g', type: 'git', path: '~/g' })).toThrow();
  });
});

describe('removeVault', () => {
  it('removes an existing vault', () => {
    const { config } = addVault(base(), { name: 'a', type: 'local', path: '~/a' });
    expect(removeVault(config, 'a').vaults).toHaveLength(0);
  });

  it('throws when the vault is absent', () => {
    expect(() => removeVault(base(), 'nope')).toThrow(/not found/);
  });
});

describe('paths + formatting', () => {
  it('expands a leading ~/ against HOME', () => {
    const prev = process.env['HOME'];
    process.env['HOME'] = '/home/tester';
    expect(expandHome('~/vaults/x')).toBe('/home/tester/vaults/x');
    expect(expandHome('/abs/x')).toBe('/abs/x');
    process.env['HOME'] = prev;
  });

  it('places the index db under the config dir', () => {
    const prev = process.env['AGENTAGE_CONFIG_DIR'];
    process.env['AGENTAGE_CONFIG_DIR'] = '/tmp/cfg';
    expect(indexDbPath('work')).toBe('/tmp/cfg/index/work.db');
    process.env['AGENTAGE_CONFIG_DIR'] = prev;
  });

  it('formats a git line with its remote', () => {
    const { vault } = addVault(base(), {
      name: 'work',
      type: 'git',
      path: '~/w',
      remote: 'git@github.com:me/w.git',
    });
    const line = formatVaultLine(vault);
    expect(line).toContain('work');
    expect(line).toContain('git');
    expect(line).toContain('git@github.com:me/w.git');
  });
});
