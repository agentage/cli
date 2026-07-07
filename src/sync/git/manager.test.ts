import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VaultsConfig } from '@agentage/memory-core';
import { type SyncResult } from './cycle.js';
import { createSyncManager } from './manager.js';
import { type SyncTarget } from './planner.js';

const ok = (t: SyncTarget): SyncResult => ({
  vault: t.vault,
  remote: t.remote,
  ok: true,
  committed: false,
  pushed: true,
  conflicts: [],
});

const config = (vaults: NonNullable<VaultsConfig['vaults']>): VaultsConfig => ({
  version: 1,
  vaults,
});

describe('createSyncManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules only interval>0 targets and fires them on the interval', async () => {
    const runs: string[] = [];
    const runCycle = vi.fn(async (t: SyncTarget) => {
      runs.push(t.vault);
      return ok(t);
    });
    const manager = createSyncManager({
      getConfig: () =>
        config({
          auto: { path: '/tmp/a', origin: [{ remote: 'git@h:a.git', interval: 1 }] },
          manual: { path: '/tmp/m', origin: [{ remote: 'git@h:m.git', interval: 0 }] },
        }),
      runCycle,
    });
    manager.reschedule();

    // Both appear in status (manual as scheduled/manual); only auto has a timer.
    expect(
      manager
        .status()
        .vaults.map((v) => v.vault)
        .sort()
    ).toEqual(['auto', 'manual']);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toEqual(['auto']);
    manager.stop();
  });

  it('records last-run and last-error per vault', async () => {
    const runCycle = vi.fn(async (t: SyncTarget): Promise<SyncResult> => ({
      ...ok(t),
      ok: false,
      pushed: false,
      reason: 'unreachable',
      error: 'boom',
    }));
    const manager = createSyncManager({
      getConfig: () =>
        config({ v: { path: '/tmp/v', origin: [{ remote: 'git@h:v.git', interval: 0 }] } }),
      runCycle,
    });
    await manager.runNow('v');
    const state = manager.status().vaults[0];
    expect(state?.lastError).toBe('boom');
    expect(state?.lastResult?.reason).toBe('unreachable');
    expect(state?.lastRun).toBeDefined();
  });

  it('serialises a target against itself (no overlapping cycles)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const runCycle = vi.fn(async (t: SyncTarget) => {
      await gate;
      return ok(t);
    });
    const manager = createSyncManager({
      getConfig: () =>
        config({ v: { path: '/tmp/v', origin: [{ remote: 'git@h:v.git', interval: 0 }] } }),
      runCycle,
    });
    const first = manager.runNow('v');
    const second = await manager.runNow('v'); // in-flight -> busy skip, does not re-enter runCycle
    expect(second.skipped).toBe('busy');
    release();
    await first;
    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it('runNow throws for a vault with no configured origin', async () => {
    const manager = createSyncManager({ getConfig: () => config({}) });
    await expect(manager.runNow('nope')).rejects.toThrow(/no sync origin/);
  });

  it('reschedule drops timers/state for vaults removed from the config', async () => {
    let vaults: NonNullable<VaultsConfig['vaults']> = {
      v: { path: '/tmp/v', origin: [{ remote: 'git@h:v.git', interval: 5 }] },
    };
    const manager = createSyncManager({
      getConfig: () => config(vaults),
      runCycle: async (t) => ok(t),
    });
    manager.reschedule();
    expect(manager.status().vaults).toHaveLength(1);
    vaults = {};
    manager.reschedule();
    expect(manager.status().vaults).toHaveLength(0);
    manager.stop();
  });
});
