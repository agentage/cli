import { statSync, watch as fsWatch } from 'node:fs';
import {
  expandPath,
  scanDiscoverRoots,
  type DiscoverCandidate,
  type VaultsConfig,
} from '@agentage/memory-core';
import { defaultProvisionDeps, provisionAccountVault } from '../../lib/provision.js';
import { addVault } from '../../lib/vault-registry.js';
import { loadVaultsConfig, saveVaultsConfig } from '../../lib/vaults.js';

// The daemon-side live-autodiscovery loop (M5): fs.watch each `discover` root plus a slow polling
// fallback for watch-unreliable filesystems, register any new subfolder as an account vault, and
// let the existing vaults.json-change reactions bring the engine + sync loops up without a restart.

export interface DiscoverStatus {
  // The configured discover roots, expanded to absolute paths, so the feature is observable.
  roots: string[];
}

interface Watcher {
  close(): void;
}

export interface DiscoverWatcherDeps {
  getConfig?: () => VaultsConfig;
  loadConfig?: () => VaultsConfig; // re-read at save time (re-load-check-save)
  saveConfig?: (config: VaultsConfig) => void;
  scan?: (config: VaultsConfig) => DiscoverCandidate[];
  provision?: (name: string) => Promise<unknown>;
  isDirectory?: (path: string) => boolean;
  watch?: (dir: string, onChange: () => void) => Watcher;
  debounceMs?: number;
  pollMs?: number;
  log?: (msg: string) => void;
}

export interface DiscoverWatcher {
  reschedule(): void;
  scanNow(): Promise<DiscoverCandidate[]>;
  status(): DiscoverStatus;
  stop(): void;
}

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Floors: a 0/near-0 poll interval would busy-loop the daemon; a 0 debounce defeats coalescing.
const POLL_FLOOR_MS = 1000;
const DEBOUNCE_FLOOR_MS = 50;

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const defaultWatch = (dir: string, onChange: () => void): Watcher => {
  const w = fsWatch(dir, { persistent: false }, () => onChange());
  w.on('error', () => {}); // an unreliable fs: the poll fallback still covers the root
  return w;
};

export const createDiscoverWatcher = (deps: DiscoverWatcherDeps = {}): DiscoverWatcher => {
  const getConfig = deps.getConfig ?? (() => loadVaultsConfig().config);
  const loadConfig = deps.loadConfig ?? (() => loadVaultsConfig().config);
  const saveConfig = deps.saveConfig ?? saveVaultsConfig;
  const scan = deps.scan ?? scanDiscoverRoots;
  const provision =
    deps.provision ?? ((name: string) => provisionAccountVault(name, defaultProvisionDeps()));
  const isDirectory = deps.isDirectory ?? isDir;
  const watch = deps.watch ?? defaultWatch;
  const debounceMs = Math.max(DEBOUNCE_FLOOR_MS, deps.debounceMs ?? 500);
  const pollMs = Math.max(POLL_FLOOR_MS, deps.pollMs ?? 60_000);
  const log = deps.log ?? (() => {});

  const watchers: Watcher[] = [];
  let debounceTimer: NodeJS.Timeout | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let scanning = false;
  let queued = false;

  const roots = (config: VaultsConfig): string[] =>
    (config.discover ?? []).map((r) => expandPath(r.path));

  const runScan = async (): Promise<DiscoverCandidate[]> => {
    let candidates: DiscoverCandidate[];
    try {
      candidates = scan(getConfig());
    } catch (err) {
      log(`scan failed: ${msgOf(err)}`);
      return [];
    }
    if (candidates.length === 0) return [];
    // Re-load-check-save: re-read the on-disk config right before the save so a recent edit by
    // another writer is folded in. In-process safe + atomic rename; a lockless cross-process RMW
    // can still lose an update (follow-up: cross-process config locking).
    let fresh: VaultsConfig;
    try {
      fresh = loadConfig();
    } catch (err) {
      log(`reload failed: ${msgOf(err)}`);
      return [];
    }
    let next = fresh;
    const added: DiscoverCandidate[] = [];
    for (const c of candidates) {
      if (fresh.vaults?.[c.name]) continue; // registered by a concurrent writer
      if (!c.entry.path || !isDirectory(c.entry.path)) continue; // vanished before we wrote it
      try {
        next = addVault(next, c.name, c.entry);
        added.push(c);
      } catch (err) {
        log(`register '${c.name}' failed: ${msgOf(err)}`);
      }
    }
    if (added.length === 0) return [];
    try {
      saveConfig(next);
    } catch (err) {
      log(`save failed: ${msgOf(err)}`);
      return [];
    }
    for (const c of added) {
      log(`discovered account vault '${c.name}' -> ${c.entry.path}`);
      void provision(c.name).catch(() => {}); // never fatal: the couch loop re-provisions
    }
    return added;
  };

  // Serialise scans against themselves; a change during an in-flight scan queues one more pass.
  const scanNow = async (): Promise<DiscoverCandidate[]> => {
    if (scanning) {
      queued = true;
      return [];
    }
    scanning = true;
    try {
      return await runScan();
    } finally {
      scanning = false;
      if (queued) {
        queued = false;
        void scanNow();
      }
    }
  };

  const debounced = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void scanNow();
    }, debounceMs);
    debounceTimer.unref?.();
  };

  const closeWatchers = (): void => {
    for (const w of watchers.splice(0)) {
      try {
        w.close();
      } catch {
        // already closed
      }
    }
  };

  const reschedule = (): void => {
    closeWatchers();
    const config = getConfig();
    for (const dir of roots(config).filter(isDirectory)) {
      try {
        watchers.push(watch(dir, debounced));
      } catch (err) {
        log(`watch ${dir} failed: ${msgOf(err)}`);
      }
    }
    // The poll fallback runs while any root is configured (even one not yet a directory), so a root
    // created after boot is still picked up where fs.watch is unreliable.
    if (roots(config).length > 0 && !pollTimer) {
      pollTimer = setInterval(() => void scanNow(), pollMs);
      pollTimer.unref?.();
    } else if (roots(config).length === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    void scanNow(); // initial scan on boot, and a re-scan whenever the config changes
  };

  const stop = (): void => {
    closeWatchers();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  return { reschedule, scanNow, status: () => ({ roots: roots(getConfig()) }), stop };
};
