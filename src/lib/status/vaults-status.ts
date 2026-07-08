import { isAccountVault, type VaultEntry, type VaultsConfig } from '@agentage/memory-core';
import { loadVaultsConfig } from '../vault/vaults.js';
import { type SyncStatus } from '../../sync/git/manager.js';

export type VaultChannel = 'local' | 'git' | 'cloud';
export type VaultSyncState = 'ok' | 'syncing' | 'error' | 'idle' | 'unknown';

export interface VaultStatus {
  name: string;
  channel: VaultChannel;
  status: VaultSyncState;
  lastRun?: string;
  lastError?: string;
}

// Config alone decides the channel: an `agentage` origin is the cloud (couch) channel, any other
// origin is an external git remote, and no origin at all is a local-only vault (nothing to sync).
const channelOf = (entry: VaultEntry): VaultChannel => {
  if (isAccountVault(entry)) return 'cloud';
  return entry.origin?.some((o) => o.remote.trim() && o.remote.trim() !== 'agentage')
    ? 'git'
    : 'local';
};

// Live state from the daemon wins; a local-only vault is `idle` (nothing to sync), and any synced
// vault with no daemon report is `unknown` (daemon down or the vault not yet scheduled).
const stateFrom = (
  channel: VaultChannel,
  live: { running?: boolean; lastError?: string; lastRun?: string } | undefined,
  daemonUp: boolean
): VaultSyncState => {
  if (channel === 'local') return 'idle';
  if (!daemonUp) return 'unknown';
  if (!live) return 'unknown';
  if (live.lastError) return 'error';
  if (live.running) return 'syncing';
  return live.lastRun ? 'ok' : 'idle';
};

// Index the daemon's per-vault reports by name across both channels into one lookup.
const indexLive = (
  sync: SyncStatus | null
): Map<string, { running?: boolean; lastError?: string; lastRun?: string }> => {
  const map = new Map<string, { running?: boolean; lastError?: string; lastRun?: string }>();
  for (const v of sync?.vaults ?? [])
    map.set(v.vault, { running: v.running, lastError: v.lastError, lastRun: v.lastRun });
  for (const c of sync?.couch ?? [])
    map.set(c.vault, { running: c.running, lastError: c.lastError, lastRun: c.lastSync });
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
