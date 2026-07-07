import { expandPath, type VaultsConfig } from '@agentage/memory-core';
import { isSafeRemoteUrl, redactRemoteUrl } from './remote-url.js';

// The unified schema stores interval as a bare non-negative integer; sync treats it as SECONDS
// (there is no minutes marker in the schema, so seconds is the least-surprising reading and keeps
// tests fast). 0 means manual-only (excluded from the daemon auto loop).
export const DEFAULT_INTERVAL_SECONDS = 300;

// When `ignore` is absent these editor/runtime files are excluded from sync; a set value REPLACES
// the defaults, and an empty array syncs everything.
export const DEFAULT_IGNORE: readonly string[] = ['.obsidian/', 'data.json'];

// The reserved cloud channel is never synced over external git (that path is out of scope here).
const RESERVED_REMOTE = 'agentage';

export interface SyncTarget {
  vault: string;
  path: string; // absolute local working-copy path
  remoteName: string; // git remote name for this origin
  remote: string; // remote URL
  intervalSeconds: number;
  ignore: string[];
}

export const resolveIgnore = (ignore: string[] | undefined): string[] =>
  ignore === undefined ? [...DEFAULT_IGNORE] : ignore;

export const intervalMs = (seconds: number): number => Math.max(0, Math.floor(seconds)) * 1000;

// One vault may carry several origins; each gets a distinct remote name within its own repo.
const remoteNameFor = (index: number): string => (index === 0 ? 'sync' : `sync-${index}`);

// Flatten (vault, origin) pairs into sync targets. A target needs a local `path` (the working
// copy to commit/push from) AND an external origin; origin-only entries (cloud remote backends)
// and the reserved cloud channel are skipped.
export const syncTargets = (config: VaultsConfig): SyncTarget[] => {
  const out: SyncTarget[] = [];
  for (const [vault, entry] of Object.entries(config.vaults ?? {})) {
    if (!entry.path || !entry.origin?.length) continue;
    entry.origin.forEach((origin, index) => {
      const remote = origin.remote.trim();
      if (!remote || remote === RESERVED_REMOTE) return;
      // One poisoned origin must not run code or kill the whole cycle: skip it with a warning.
      if (!isSafeRemoteUrl(remote)) {
        console.warn(
          `agentage: skipping unsafe remote for vault '${vault}': ${redactRemoteUrl(remote)}`
        );
        return;
      }
      out.push({
        vault,
        path: expandPath(entry.path as string),
        remoteName: remoteNameFor(index),
        remote,
        intervalSeconds: origin.interval ?? DEFAULT_INTERVAL_SECONDS,
        ignore: resolveIgnore(origin.ignore),
      });
    });
  }
  return out;
};

// The targets the daemon auto-loop schedules: interval 0 is manual-only and excluded.
export const autoSyncTargets = (config: VaultsConfig): SyncTarget[] =>
  syncTargets(config).filter((t) => t.intervalSeconds > 0);
