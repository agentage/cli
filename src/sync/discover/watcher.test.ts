import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverCandidate, VaultsConfig } from '@agentage/memory-core';
import { createDiscoverWatcher } from './watcher.js';

const HUGE = 10 ** 9; // an effectively-disabled poll interval for the non-poll tests

const candidate = (name: string): DiscoverCandidate => ({
  name,
  entry: { path: `/root/${name}`, origin: [{ remote: 'agentage' }], mcp: ['local'] },
});

describe('discover watcher', () => {
  it('coalesces rapid change events into a single debounced rescan', async () => {
    vi.useFakeTimers();
    const scan = vi.fn((): DiscoverCandidate[] => []);
    let fire = (): void => {};
    const w = createDiscoverWatcher({
      getConfig: () => ({ version: 1, discover: [{ path: '/root' }], vaults: {} }),
      scan,
      isDirectory: () => true,
      watch: (_dir, onChange) => {
        fire = onChange;
        return { close: () => {} };
      },
      debounceMs: 500,
      pollMs: HUGE,
    });
    w.reschedule(); // one initial scan + captures the change callback
    expect(scan).toHaveBeenCalledTimes(1);
    fire();
    fire();
    fire();
    expect(scan).toHaveBeenCalledTimes(1); // still inside the debounce window
    await vi.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(2); // three events collapse to one rescan
    w.stop();
    vi.useRealTimers();
  });

  it('re-watches and rescans when the config gains a root', async () => {
    const configs: VaultsConfig[] = [
      { version: 1, vaults: {} },
      { version: 1, discover: [{ path: '/root' }], vaults: {} },
    ];
    let idx = 0;
    const scan = vi.fn((): DiscoverCandidate[] => []);
    const watched: string[] = [];
    const w = createDiscoverWatcher({
      getConfig: () => configs[idx]!,
      scan,
      isDirectory: () => true,
      watch: (dir) => {
        watched.push(dir);
        return { close: () => {} };
      },
      pollMs: HUGE,
    });
    w.reschedule();
    expect(watched).toEqual([]); // no roots configured yet
    idx = 1;
    w.reschedule();
    await Promise.resolve();
    expect(watched).toEqual(['/root']);
    expect(scan).toHaveBeenCalledTimes(2); // one scan per reschedule
    w.stop();
  });

  it('writes discovered candidates onto the freshly re-read config (re-load-check-save)', async () => {
    const snapshot: VaultsConfig = { version: 1, discover: [{ path: '/root' }], vaults: {} };
    // Disk gained an unrelated vault between the scan and the save (an external writer).
    const disk: VaultsConfig = {
      version: 1,
      discover: [{ path: '/root' }],
      vaults: { personal: { path: '/p', mcp: ['local'] } },
    };
    let saved: VaultsConfig | undefined;
    const provisioned: string[] = [];
    const w = createDiscoverWatcher({
      getConfig: () => snapshot,
      loadConfig: () => disk,
      saveConfig: (c) => void (saved = c),
      scan: () => [candidate('teamnotes')],
      isDirectory: () => true,
      provision: async (n) => void provisioned.push(n),
      watch: () => ({ close: () => {} }),
      pollMs: HUGE,
    });
    const added = await w.scanNow();
    expect(added.map((c) => c.name)).toEqual(['teamnotes']);
    expect(saved?.vaults?.personal).toEqual({ path: '/p', mcp: ['local'] }); // unrelated preserved
    expect(saved?.vaults?.teamnotes).toEqual(candidate('teamnotes').entry);
    expect(provisioned).toEqual(['teamnotes']);
    w.stop();
  });

  it('skips a candidate a concurrent writer already registered, writing nothing', async () => {
    let saved: VaultsConfig | undefined;
    const w = createDiscoverWatcher({
      getConfig: () => ({ version: 1, discover: [{ path: '/root' }], vaults: {} }),
      loadConfig: () => ({
        version: 1,
        discover: [{ path: '/root' }],
        vaults: { teamnotes: { path: '/root/teamnotes', mcp: ['local'] } },
      }),
      saveConfig: (c) => void (saved = c),
      scan: () => [candidate('teamnotes')],
      isDirectory: () => true,
      watch: () => ({ close: () => {} }),
      pollMs: HUGE,
    });
    expect(await w.scanNow()).toEqual([]);
    expect(saved).toBeUndefined();
    w.stop();
  });

  it('does not register a candidate whose directory vanished before the write', async () => {
    let saved: VaultsConfig | undefined;
    const cfg: VaultsConfig = { version: 1, discover: [{ path: '/root' }], vaults: {} };
    const w = createDiscoverWatcher({
      getConfig: () => cfg,
      loadConfig: () => cfg,
      saveConfig: (c) => void (saved = c),
      scan: () => [candidate('gone')],
      isDirectory: (p) => p !== '/root/gone', // the candidate dir is no longer a directory
      watch: () => ({ close: () => {} }),
      pollMs: HUGE,
    });
    expect(await w.scanNow()).toEqual([]);
    expect(saved).toBeUndefined();
    w.stop();
  });

  it('propagates an autosync:false root as interval-0 discovered entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentage-discover-'));
    mkdirSync(join(root, 'teamnotes'));
    const cfg: VaultsConfig = {
      version: 1,
      discover: [{ path: root, autosync: false }],
      vaults: {},
    };
    let saved: VaultsConfig | undefined;
    try {
      // Real scanDiscoverRoots + real isDirectory here: this exercises the autosync=false path.
      const w = createDiscoverWatcher({
        getConfig: () => cfg,
        loadConfig: () => cfg,
        saveConfig: (c) => void (saved = c),
        provision: async () => {},
        watch: () => ({ close: () => {} }),
        pollMs: HUGE,
      });
      const added = await w.scanNow();
      expect(added).toHaveLength(1);
      expect(saved?.vaults?.teamnotes?.origin?.[0]).toEqual({ remote: 'agentage', interval: 0 });
      w.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the polling fallback on its interval when no directory is watchable', async () => {
    vi.useFakeTimers();
    const scan = vi.fn((): DiscoverCandidate[] => []);
    const w = createDiscoverWatcher({
      getConfig: () => ({ version: 1, discover: [{ path: '/root' }], vaults: {} }),
      scan,
      isDirectory: () => false, // nothing to fs.watch -> only the poll fallback drives scans
      watch: () => ({ close: () => {} }),
      pollMs: 1000,
    });
    w.reschedule();
    expect(scan).toHaveBeenCalledTimes(1); // the initial scan
    await vi.advanceTimersByTimeAsync(1000);
    expect(scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(scan).toHaveBeenCalledTimes(3);
    w.stop();
    vi.useRealTimers();
  });

  it('floors a 0 poll interval and a 0 debounce so neither can busy-loop', async () => {
    vi.useFakeTimers();
    const scan = vi.fn((): DiscoverCandidate[] => []);
    let fire = (): void => {};
    const w = createDiscoverWatcher({
      getConfig: () => ({ version: 1, discover: [{ path: '/root' }], vaults: {} }),
      scan,
      isDirectory: () => true,
      watch: (_dir, onChange) => {
        fire = onChange;
        return { close: () => {} };
      },
      debounceMs: 0,
      pollMs: 0,
    });
    w.reschedule(); // the initial scan
    fire();
    await vi.advanceTimersByTimeAsync(49);
    expect(scan).toHaveBeenCalledTimes(1); // debounce floored to 50ms, not 0
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(949);
    expect(scan).toHaveBeenCalledTimes(2); // poll floored to 1000ms, not a ~1ms busy-loop
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(3);
    w.stop();
    vi.useRealTimers();
  });

  it('reports the configured discover roots in status', () => {
    const w = createDiscoverWatcher({
      getConfig: () => ({ version: 1, discover: [{ path: '/a' }, { path: '/b' }], vaults: {} }),
      watch: () => ({ close: () => {} }),
      pollMs: HUGE,
    });
    expect(w.status().roots).toEqual(['/a', '/b']);
    w.stop();
  });
});
