import { describe, expect, it } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import { resolveMutationTarget } from './mutation-target.js';

const config: VaultsConfig = {
  version: 1,
  default: 'acct',
  vaults: {
    acct: { path: '/tmp/acct', origin: [{ remote: 'agentage', interval: 0 }] },
    git: { path: '/tmp/git', origin: [{ remote: 'git@h:g.git' }] },
    local: { path: '/tmp/local' },
  },
};

describe('resolveMutationTarget', () => {
  it('maps a bare ref to the default vault when it is an account vault', () => {
    expect(resolveMutationTarget(config, { ref: 'notes/x.md' })).toEqual({
      vault: 'acct',
      path: 'notes/x.md',
    });
  });

  it('honours an explicit @vault/ prefix', () => {
    expect(resolveMutationTarget(config, { ref: '@acct/a/b.md' })).toEqual({
      vault: 'acct',
      path: 'a/b.md',
    });
  });

  it('honours opts.vault over the default', () => {
    expect(resolveMutationTarget(config, { ref: 'z.md', opts: { vault: 'acct' } })).toEqual({
      vault: 'acct',
      path: 'z.md',
    });
  });

  it('returns null for git/local vaults and for non-file refs', () => {
    expect(resolveMutationTarget(config, { ref: '@git/z.md' })).toBeNull();
    expect(resolveMutationTarget(config, { ref: 'z.md', opts: { vault: 'local' } })).toBeNull();
    expect(resolveMutationTarget(config, { ref: '@acct' })).toBeNull();
    expect(resolveMutationTarget(config, {})).toBeNull();
  });

  it('resolves a single-vault config with no default', () => {
    const single: VaultsConfig = {
      version: 1,
      vaults: { only: { path: '/tmp/only', origin: [{ remote: 'agentage' }] } },
    };
    expect(resolveMutationTarget(single, { ref: 'n.md' })).toEqual({ vault: 'only', path: 'n.md' });
  });
});
