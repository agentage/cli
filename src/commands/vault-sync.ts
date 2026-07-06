import chalk from 'chalk';
import { type VaultsConfig } from '@agentage/memory-core';
import { health, syncRun } from '../lib/daemon-client.js';
import { daemonDisabled } from '../lib/daemon-pref.js';
import { loadVaultsConfig } from '../lib/vaults.js';
import { resolvePort } from '../daemon/lifecycle.js';
import { runSyncCycle, type SyncResult } from '../sync/cycle.js';
import { syncTargets, type SyncTarget } from '../sync/planner.js';

export interface VaultSyncDeps {
  loadConfig: () => VaultsConfig;
  // The port of a reachable daemon, or null to run in-process (daemon down or --no-daemon).
  daemonPort: () => Promise<number | null>;
  runViaDaemon: (port: number, vault: string) => Promise<SyncResult>;
  runInProcess: (target: SyncTarget) => Promise<SyncResult>;
  log: (msg: string) => void;
}

const describe = (r: SyncResult): string => {
  if (!r.ok) return chalk.red(`failed (${r.reason ?? 'error'})${r.error ? `: ${r.error}` : ''}`);
  if (r.skipped) return chalk.yellow(`skipped (${r.skipped})`);
  const bits: string[] = [];
  if (r.committed) bits.push('committed');
  if (r.conflicts.length) bits.push(`${r.conflicts.length} conflict copy(ies)`);
  if (r.pushed) bits.push('pushed');
  return chalk.green(bits.length ? bits.join(', ') : 'up to date');
};

const report = (log: (msg: string) => void, r: SyncResult): void => {
  log(`${r.vault} -> ${r.remote}: ${describe(r)}`);
  for (const c of r.conflicts) log(`  kept remote copy: ${c}`);
};

// `agentage vault sync [name]`: sync one vault (or every origin-carrying vault). Prefers a running
// daemon (single writer), else runs the cycle in-process. Works for interval-0 (manual-only)
// vaults and with the daemon down. Sync failures are surfaced, not thrown (V6: never a crash).
export const runVaultSync = async (
  name: string | undefined,
  deps: VaultSyncDeps
): Promise<void> => {
  const targets = syncTargets(deps.loadConfig()).filter((t) => !name || t.vault === name);
  if (targets.length === 0) {
    deps.log(
      name
        ? `No git origin configured for vault '${name}'.`
        : 'No git-synced vaults. Add one with `agentage vault add <name> --git <remote>`.'
    );
    return;
  }
  const port = await deps.daemonPort();
  if (port !== null) {
    for (const vault of [...new Set(targets.map((t) => t.vault))]) {
      report(deps.log, await deps.runViaDaemon(port, vault));
    }
    return;
  }
  for (const target of targets) report(deps.log, await deps.runInProcess(target));
};

const resolveDaemonPort = async (): Promise<number | null> => {
  if (daemonDisabled()) return null;
  const port = resolvePort();
  return (await health(port)) ? port : null;
};

export const defaultVaultSyncDeps = (): VaultSyncDeps => ({
  loadConfig: () => loadVaultsConfig().config,
  daemonPort: resolveDaemonPort,
  runViaDaemon: syncRun,
  runInProcess: runSyncCycle,
  log: (msg) => console.log(msg),
});
