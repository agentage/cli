import { expandPath, isAccountVault, type VaultsConfig } from '@agentage/memory-core';
import { DEFAULT_INTERVAL_SECONDS } from '../planner.js';

// The account (agentage) channel a couch target syncs to. Unlike a git target it has no external
// remote URL: the daemon resolves the per-memory CouchDB + JWT endpoints from discovery at runtime.
export const ACCOUNT_REMOTE = 'agentage';

export interface CouchTarget {
  vault: string;
  path: string; // absolute local working-copy path (the account mirror)
  intervalSeconds: number;
}

// Every account vault (agentage origin) with a local mirror path is a couch target. Interval rides
// on the agentage origin and matches git semantics: absent = 300s, 0 = manual-only.
export const couchTargets = (config: VaultsConfig): CouchTarget[] => {
  const out: CouchTarget[] = [];
  for (const [vault, entry] of Object.entries(config.vaults ?? {})) {
    if (!isAccountVault(entry) || !entry.path) continue;
    const origin = entry.origin?.find((o) => o.remote === ACCOUNT_REMOTE);
    out.push({
      vault,
      path: expandPath(entry.path),
      intervalSeconds: origin?.interval ?? DEFAULT_INTERVAL_SECONDS,
    });
  }
  return out;
};

// The couch targets the daemon auto-loop schedules: interval 0 is manual-only and excluded.
export const autoCouchTargets = (config: VaultsConfig): CouchTarget[] =>
  couchTargets(config).filter((t) => t.intervalSeconds > 0);
