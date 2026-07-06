import { describe, expect, it } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import {
  autoSyncTargets,
  DEFAULT_IGNORE,
  DEFAULT_INTERVAL_SECONDS,
  intervalMs,
  resolveIgnore,
  syncTargets,
} from './planner.js';

describe('resolveIgnore', () => {
  it('defaults to the editor/runtime files when absent', () => {
    expect(resolveIgnore(undefined)).toEqual([...DEFAULT_IGNORE]);
  });

  it('REPLACES the defaults with a set value', () => {
    expect(resolveIgnore(['secrets/'])).toEqual(['secrets/']);
  });

  it('treats an empty array as "sync everything"', () => {
    expect(resolveIgnore([])).toEqual([]);
  });
});

describe('intervalMs', () => {
  it('converts seconds to milliseconds', () => {
    expect(intervalMs(300)).toBe(300_000);
  });

  it('floors and clamps negatives to zero', () => {
    expect(intervalMs(1.9)).toBe(1_000);
    expect(intervalMs(-5)).toBe(0);
  });
});

describe('syncTargets', () => {
  const cfg = (vaults: NonNullable<VaultsConfig['vaults']>): VaultsConfig => ({
    version: 1,
    vaults,
  });

  it('includes only vaults with both a path and an external origin', () => {
    const targets = syncTargets(
      cfg({
        synced: { path: '/tmp/synced', origin: [{ remote: 'git@h:me/s.git' }] },
        localOnly: { path: '/tmp/local' },
        remoteOnly: { origin: [{ remote: 'git@h:me/r.git' }] },
        cloud: { path: '/tmp/cloud', origin: [{ remote: 'agentage' }] },
      })
    );
    expect(targets.map((t) => t.vault)).toEqual(['synced']);
    expect(targets[0]).toMatchObject({
      remote: 'git@h:me/s.git',
      remoteName: 'sync',
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      ignore: [...DEFAULT_IGNORE],
    });
  });

  it('flattens multiple origins into distinct remote names', () => {
    const targets = syncTargets(
      cfg({
        multi: {
          path: '/tmp/m',
          origin: [
            { remote: 'git@h:me/a.git', interval: 60, ignore: [] },
            { remote: 'git@h:me/b.git' },
          ],
        },
      })
    );
    expect(targets.map((t) => t.remoteName)).toEqual(['sync', 'sync-1']);
    expect(targets[0]).toMatchObject({ intervalSeconds: 60, ignore: [] });
  });

  it('skips blank remotes', () => {
    expect(syncTargets(cfg({ v: { path: '/tmp/v', origin: [{ remote: '   ' }] } }))).toEqual([]);
  });

  it('never picks up an account (agentage-origin) vault, even with a local path', () => {
    const config = cfg({
      acct: { path: '/tmp/acct', origin: [{ remote: 'agentage' }] },
      work: { path: '/tmp/work', origin: [{ remote: 'git@h:me/w.git' }] },
    });
    // The account vault is filtered out of both the on-demand targets and the auto loop.
    expect(syncTargets(config).map((t) => t.vault)).toEqual(['work']);
    expect(autoSyncTargets(config).map((t) => t.vault)).toEqual(['work']);
  });
});

describe('autoSyncTargets', () => {
  it('excludes interval 0 (manual-only) from the daemon loop', () => {
    const config: VaultsConfig = {
      version: 1,
      vaults: {
        auto: { path: '/tmp/a', origin: [{ remote: 'git@h:me/a.git', interval: 30 }] },
        manual: { path: '/tmp/m', origin: [{ remote: 'git@h:me/m.git', interval: 0 }] },
      },
    };
    expect(autoSyncTargets(config).map((t) => t.vault)).toEqual(['auto']);
    // Both are still valid sync targets; only the loop excludes the manual one.
    expect(
      syncTargets(config)
        .map((t) => t.vault)
        .sort()
    ).toEqual(['auto', 'manual']);
  });
});
