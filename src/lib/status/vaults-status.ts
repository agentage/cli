import { isAccountVault, type VaultEntry, type VaultsConfig } from '@agentage/memory-core';
import { loadVaultsConfig } from '../vault/vaults.js';
import { type SyncStatus } from '../../sync/git/manager.js';

export type VaultChannel = 'local' | 'git' | 'account';
export type VaultSyncState = 'ok' | 'syncing' | 'error' | 'idle' | 'unknown' | 'unsynced';

export interface VaultStatus {
  name: string;
  channel: VaultChannel;
  status: VaultSyncState;
  lastRun?: string;
  lastError?: string;
}

// Config alone decides the channel: an external remote means git (it really syncs), else an
// `agentage` origin means account, else local-only. External wins so a hand-edited entry carrying
// both is reported by the channel that actually moves bytes.
const channelOf = (entry: VaultEntry): VaultChannel => {
  const external = entry.origin?.some((o) => o.remote.trim() && o.remote.trim() !== 'agentage');
  if (external) return 'git';
  return isAccountVault(entry) ? 'account' : 'local';
};

// Live state from the daemon wins; a local-only vault is `idle` (nothing to sync), an account vault
// is always `unsynced` (it has no sync channel, so no daemon report can make it healthy), and any
// git vault with no daemon report is `unknown` (daemon down or the vault not yet scheduled).
const stateFrom = (
  channel: VaultChannel,
  live: { running?: boolean; lastError?: string; lastRun?: string } | undefined,
  daemonUp: boolean
): VaultSyncState => {
  if (channel === 'local') return 'idle';
  if (channel === 'account') return 'unsynced';
  if (!daemonUp) return 'unknown';
  if (!live) return 'unknown';
  if (live.lastError) return 'error';
  if (live.running) return 'syncing';
  return live.lastRun ? 'ok' : 'idle';
};

// Index the daemon's per-vault git reports by name.
const indexLive = (
  sync: SyncStatus | null
): Map<string, { running?: boolean; lastError?: string; lastRun?: string }> => {
  const map = new Map<string, { running?: boolean; lastError?: string; lastRun?: string }>();
  for (const v of sync?.vaults ?? [])
    map.set(v.vault, { running: v.running, lastError: v.lastError, lastRun: v.lastRun });
  return map;
};

// The full per-vault picture: every configured vault (so local-only vaults are never hidden),
// classified by channel and annotated with the daemon's live sync state when available.
export const buildVaultStatuses = (
  sync: SyncStatus | null,
  daemonUp: boolean,
  config: VaultsConfig = loadVaultsConfig().config
): VaultStatus[] => {
  const live = indexLive(sync);
  return Object.entries(config.vaults ?? {})
    .map(([name, entry]): VaultStatus => {
      const channel = channelOf(entry);
      const l = live.get(name);
      return {
        name,
        channel,
        status: stateFrom(channel, l, daemonUp),
        lastRun: l?.lastRun,
        lastError: l?.lastError,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};
