import { describe, expect, it } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import { autoCouchTargets, couchTargets } from './targets.js';

const config = (vaults: VaultsConfig['vaults']): VaultsConfig => ({ version: 1, vaults });

describe('couchTargets', () => {
  it('selects only account (agentage) vaults with a path', () => {
    const targets = couchTargets(
      config({
        acct: { path: '/tmp/acct', origin: [{ remote: 'agentage' }] },
        gitv: { path: '/tmp/gitv', origin: [{ remote: 'git@h:g.git' }] },
        local: { path: '/tmp/local' },
      })
    );
    expect(targets.map((t) => t.vault)).toEqual(['acct']);
    expect(targets[0]!.path).toBe('/tmp/acct');
  });

  it('defaults the interval to 300s and honours an explicit one', () => {
    const targets = couchTargets(
      config({
        a: { path: '/tmp/a', origin: [{ remote: 'agentage' }] },
        b: { path: '/tmp/b', origin: [{ remote: 'agentage', interval: 60 }] },
        c: { path: '/tmp/c', origin: [{ remote: 'agentage', interval: 0 }] },
      })
    );
    expect(Object.fromEntries(targets.map((t) => [t.vault, t.intervalSeconds]))).toEqual({
      a: 300,
      b: 60,
      c: 0,
    });
  });

  it('autoCouchTargets excludes interval-0 (manual-only) vaults', () => {
    const auto = autoCouchTargets(
      config({
        a: { path: '/tmp/a', origin: [{ remote: 'agentage', interval: 60 }] },
        c: { path: '/tmp/c', origin: [{ remote: 'agentage', interval: 0 }] },
      })
    );
    expect(auto.map((t) => t.vault)).toEqual(['a']);
  });

  it('is empty for a config with no account vaults', () => {
    expect(
      couchTargets(config({ g: { path: '/tmp/g', origin: [{ remote: 'x:y.git' }] } }))
    ).toEqual([]);
    expect(couchTargets({ version: 1 })).toEqual([]);
  });
});
