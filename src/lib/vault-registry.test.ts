import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import {
  addVault,
  appendDiscoverIgnore,
  ensureVaultDir,
  formatVaultLine,
  removeVault,
  vaultType,
} from './vault-registry.js';

const base = (): VaultsConfig => ({ version: 1, vaults: {} });

describe('addVault', () => {
  it('adds a local entry and makes the first vault the default', () => {
    const config = addVault(base(), 'scratch', { path: '~/vaults/scratch', mcp: ['local'] });
    expect(config.vaults?.scratch).toEqual({ path: '~/vaults/scratch', mcp: ['local'] });
    expect(config.default).toBe('scratch');
  });

  it('keeps the existing default when adding a second vault', () => {
    const one = addVault(base(), 'a', { path: '~/a' });
    const two = addVault(one, 'b', { path: '~/b' });
    expect(two.default).toBe('a');
    expect(Object.keys(two.vaults ?? {})).toEqual(['a', 'b']);
  });

  it('adds a git-origin entry', () => {
    const config = addVault(base(), 'work', { origin: [{ remote: 'git@github.com:me/w.git' }] });
    expect(config.vaults?.work.origin?.[0]?.remote).toBe('git@github.com:me/w.git');
  });

  it('rejects a duplicate name', () => {
    const config = addVault(base(), 'a', { path: '~/a' });
    expect(() => addVault(config, 'a', { path: '~/b' })).toThrow(/already exists/);
  });

  it('rejects an invalid name', () => {
    expect(() => addVault(base(), 'bad name', { path: '~/x' })).toThrow(/invalid vault name/);
  });

  it('rejects an entry with neither path nor origin', () => {
    expect(() => addVault(base(), 'x', {})).toThrow(/origin and\/or a path/);
  });
});

describe('removeVault', () => {
  it('removes an entry and reassigns the default', () => {
    let config = addVault(base(), 'a', { path: '~/a' });
    config = addVault(config, 'b', { path: '~/b' });
    const next = removeVault(config, 'a');
    expect(Object.keys(next.vaults ?? {})).toEqual(['b']);
    expect(next.default).toBe('b');
  });

  it('drops the default when the last vault is removed', () => {
    const config = addVault(base(), 'a', { path: '~/a' });
    const next = removeVault(config, 'a');
    expect(next.vaults).toEqual({});
    expect(next.default).toBeUndefined();
  });

  it('throws when the vault is absent', () => {
    expect(() => removeVault(base(), 'nope')).toThrow(/not found/);
  });
});

describe('appendDiscoverIgnore', () => {
  const withRoot = (ignore?: string[]): VaultsConfig => ({
    version: 1,
    discover: [{ path: '/data/roots', ...(ignore ? { ignore } : {}) }],
    vaults: {},
  });

  it('appends the name to the root the vault path sits directly under', () => {
    const res = appendDiscoverIgnore(withRoot(), 'teamnotes', '/data/roots/teamnotes');
    expect(res).not.toBeNull();
    expect(res!.root).toBe('/data/roots');
    expect(res!.config.discover?.[0]?.ignore).toEqual(['teamnotes']);
  });

  it('preserves an existing ignore list', () => {
    const res = appendDiscoverIgnore(withRoot(['old']), 'teamnotes', '/data/roots/teamnotes');
    expect(res!.config.discover?.[0]?.ignore).toEqual(['old', 'teamnotes']);
  });

  it('is idempotent when the name is already ignored', () => {
    const res = appendDiscoverIgnore(withRoot(['teamnotes']), 'teamnotes', '/data/roots/teamnotes');
    expect(res!.config.discover?.[0]?.ignore).toEqual(['teamnotes']);
  });

  it('returns null for a vault nested deeper than a direct child of the root', () => {
    expect(appendDiscoverIgnore(withRoot(), 'x', '/data/roots/sub/x')).toBeNull();
  });

  it('returns null when the path is not under any discover root', () => {
    expect(appendDiscoverIgnore(withRoot(), 'elsewhere', '/other/place/elsewhere')).toBeNull();
  });

  it('returns null when there are no discover roots', () => {
    expect(appendDiscoverIgnore({ version: 1, vaults: {} }, 'x', '/data/roots/x')).toBeNull();
  });
});

describe('vaultType', () => {
  it('classifies an agentage-origin entry as account', () => {
    expect(vaultType({ path: '~/vaults/acct', origin: [{ remote: 'agentage' }] })).toBe('account');
  });

  it('classifies a path with an external origin as git', () => {
    expect(vaultType({ path: '~/w', origin: [{ remote: 'git@h:me/w.git' }] })).toBe('git');
  });

  it('classifies a bare path as local and an origin-only entry as remote', () => {
    expect(vaultType({ path: '/tmp/a' })).toBe('local');
    expect(vaultType({ origin: [{ remote: 'git@h:me/r.git' }] })).toBe('remote');
  });
});

describe('formatVaultLine', () => {
  it('labels a local vault', () => {
    expect(formatVaultLine('a', { path: '/tmp/a' })).toContain('local');
  });

  it('labels a git-origin vault with its remote', () => {
    const line = formatVaultLine('work', { origin: [{ remote: 'git@github.com:me/w.git' }] });
    expect(line).toContain('remote');
    expect(line).toContain('git@github.com:me/w.git');
  });

  it('labels an account vault by type and does not echo the agentage channel as a git remote', () => {
    const line = formatVaultLine('acct', { path: '/tmp/acct', origin: [{ remote: 'agentage' }] });
    expect(line).toContain('account');
    expect(line).not.toContain('<- agentage');
  });
});

describe('ensureVaultDir', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'agentage-reg-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the directory when missing', () => {
    const target = join(dir, 'nested', 'vault');
    ensureVaultDir(target);
    expect(existsSync(target)).toBe(true);
  });
});
