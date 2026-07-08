import { type VaultsConfig } from '@agentage/memory-core';
import { loadVaultsConfig } from '../../lib/vault/vaults.js';
import { type CouchTargetStatus } from '../couch/manager.js';
import { type DiscoverStatus } from '../discover/watcher.js';
import { runSyncCycle, type SyncResult } from './cycle.js';
import { autoSyncTargets, intervalMs, syncTargets, type SyncTarget } from './planner.js';

export interface VaultSyncState {
  vault: string;
  remote: string;
  intervalSeconds: number;
  running: boolean;
  lastRun?: string;
  lastError?: string;
  lastResult?: Pick<SyncResult, 'ok' | 'pushed' | 'committed' | 'conflicts' | 'skipped' | 'reason'>;
}

export interface SyncStatus {
  vaults: VaultSyncState[];
  // The account (couch) targets, composed in by the daemon; absent on an older daemon.
  couch?: CouchTargetStatus[];
  // The active discover roots, composed in by the daemon; absent on an older daemon.
  discover?: DiscoverStatus;
}

export interface SyncManagerDeps {
  getConfig?: () => VaultsConfig;
  runCycle?: (target: SyncTarget) => Promise<SyncResult>;
}

export interface SyncManager {
  // (Re)build the per-target timers from the current config; call on boot and on config change.
  reschedule(): void;
  // Force a sync of every origin of one vault now (works for interval 0 and daemon-scheduled alike).
  runNow(vault: string): Promise<SyncResult>;
  status(): SyncStatus;
  stop(): void;
}

const busy = (t: SyncTarget): SyncResult => ({
  vault: t.vault,
  remote: t.remote,
  ok: true,
  committed: false,
  pushed: false,
  conflicts: [],
  skipped: 'busy',
});

// The daemon-side scheduler: owns per-target timers, serialises each target against itself (an
// in-process running flag - no overlapping cycles), and records last-run/last-error for status.
export const createSyncManager = (deps: SyncManagerDeps = {}): SyncManager => {
  const getConfig = deps.getConfig ?? (() => loadVaultsConfig().config);
  const runCycle = deps.runCycle ?? runSyncCycle;
  const states = new Map<string, VaultSyncState>();
  const timers = new Map<string, NodeJS.Timeout>();
  const keyOf = (t: SyncTarget): string => `${t.vault}::${t.remoteName}`;

  const ensureState = (t: SyncTarget): VaultSyncState => {
    const existing = states.get(keyOf(t));
    if (existing) {
      existing.remote = t.remote;
      existing.intervalSeconds = t.intervalSeconds;
      return existing;
    }
    const fresh: VaultSyncState = {
      vault: t.vault,
      remote: t.remote,
      intervalSeconds: t.intervalSeconds,
      running: false,
    };
    states.set(keyOf(t), fresh);
    return fresh;
  };

  const runTarget = async (t: SyncTarget): Promise<SyncResult> => {
    const state = ensureState(t);
    if (state.running) return busy(t); // serialise: no overlapping cycles per target
    state.running = true;
    try {
      const result = await runCycle(t);
      state.lastRun = new Date().toISOString();
      state.lastError = result.ok ? undefined : result.error;
      state.lastResult = {
        ok: result.ok,
        pushed: result.pushed,
        committed: result.committed,
        conflicts: result.conflicts,
        skipped: result.skipped,
        reason: result.reason,
      };
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.lastRun = new Date().toISOString();
      state.lastError = message;
      state.lastResult = {
        ok: false,
        pushed: false,
        committed: false,
        conflicts: [],
        reason: 'other',
      };
      return {
        vault: t.vault,
        remote: t.remote,
        ok: false,
        committed: false,
        pushed: false,
        conflicts: [],
        reason: 'other',
        error: message,
      };
    } finally {
      state.running = false;
    }
  };

  const runNow = async (vault: string): Promise<SyncResult> => {
    const targets = syncTargets(getConfig()).filter((t) => t.vault === vault);
    if (targets.length === 0) throw new Error(`no sync origin configured for vault '${vault}'`);
    let last = busy(targets[0] as SyncTarget);
    for (const t of targets) last = await runTarget(t);
    return last;
  };

  const reschedule = (): void => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    const all = syncTargets(getConfig());
    const live = new Set(all.map(keyOf));
    for (const key of [...states.keys()]) if (!live.has(key)) states.delete(key);
    for (const t of all) ensureState(t);
    for (const t of autoSyncTargets(getConfig())) {
      const timer = setInterval(() => void runTarget(t), intervalMs(t.intervalSeconds));
      timer.unref?.();
      timers.set(keyOf(t), timer);
    }
  };

  const stop = (): void => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  };

  return { reschedule, runNow, status: () => ({ vaults: [...states.values()] }), stop };
};
