import chalk from 'chalk';
import { type VaultsConfig } from '@agentage/memory-core';
import { health, syncRun, type SyncRunResult } from '../lib/daemon-client.js';
import { daemonDisabled } from '../lib/daemon-pref.js';
import { loadVaultsConfig } from '../lib/vaults.js';
import { resolvePort } from '../daemon/lifecycle.js';
import { runSyncCycle, type SyncResult } from '../sync/cycle.js';
import { createCouchSyncManager, type CouchSyncResult } from '../sync/couch/manager.js';
import { couchTargets } from '../sync/couch/targets.js';
import { syncTargets, type SyncTarget } from '../sync/planner.js';
import { redactRemoteUrl } from '../sync/remote-url.js';

export interface VaultSyncDeps {
  loadConfig: () => VaultsConfig;
  // The port of a reachable daemon, or null to run in-process (daemon down or --no-daemon).
  daemonPort: () => Promise<number | null>;
  runViaDaemon: (port: number, vault: string) => Promise<SyncRunResult>;
  runGitInProcess: (target: SyncTarget) => Promise<SyncResult>;
  runCouchInProcess: (vault: string) => Promise<CouchSyncResult>;
  log: (msg: string) => void;
}

const isCouch = (r: SyncRunResult): r is CouchSyncResult => 'channel' in r && r.channel === 'couch';

const describeGit = (r: SyncResult): string => {
  if (!r.ok) return chalk.red(`failed (${r.reason ?? 'error'})${r.error ? `: ${r.error}` : ''}`);
  if (r.skipped) return chalk.yellow(`skipped (${r.skipped})`);
  const bits: string[] = [];
  if (r.committed) bits.push('committed');
  if (r.conflicts.length) bits.push(`${r.conflicts.length} conflict copy(ies)`);
  if (r.pushed) bits.push('pushed');
  return chalk.green(bits.length ? bits.join(', ') : 'up to date');
};

const describeCouch = (r: CouchSyncResult): string => {
  if (r.paused) return chalk.yellow(`paused (${r.paused})`);
  if (!r.ok) return chalk.red(`failed${r.error ? `: ${r.error}` : ''}`);
  const bits: string[] = [];
  if (r.committed) bits.push('committed');
  if (r.pulled) bits.push('pulled');
  if (r.pendingCount) bits.push(`${r.pendingCount} pending`);
  return chalk.green(bits.length ? bits.join(', ') : 'up to date');
};

const report = (log: (msg: string) => void, r: SyncRunResult): void => {
  if (isCouch(r)) {
    log(`${r.vault} (account): ${describeCouch(r)}`);
    return;
  }
  log(`${r.vault} -> ${redactRemoteUrl(r.remote)}: ${describeGit(r)}`);
  for (const c of r.conflicts) log(`  kept remote copy: ${c}`);
};

// `agentage vault sync [name]`: sync one vault (or every syncable vault). Git-origin vaults
// commit + push + pull-rebase; account (agentage) vaults sync the couch channel. Prefers a running
// daemon (single writer), else runs the cycle in-process. Works for interval-0 (manual-only) vaults
// and with the daemon down. Failures are surfaced, not thrown (V6: never a crash).
export const runVaultSync = async (
  name: string | undefined,
  deps: VaultSyncDeps
): Promise<void> => {
  const config = deps.loadConfig();
  // A named vault that is not registered is an error (mirrors `vault remove`), not a silent no-op.
  if (name && !(config.vaults ?? {})[name]) throw new Error(`vault '${name}' not found`);
  const gitTargets = syncTargets(config).filter((t) => !name || t.vault === name);
  const couchVaults = couchTargets(config)
    .filter((t) => !name || t.vault === name)
    .map((t) => t.vault);
  if (gitTargets.length === 0 && couchVaults.length === 0) {
    deps.log(
      name
        ? `No syncable origin configured for vault '${name}'.`
        : 'No syncable vaults. Add one with `agentage vault add <name>`.'
    );
    return;
  }
  const vaults = [...new Set([...gitTargets.map((t) => t.vault), ...couchVaults])];
  deps.log(`Syncing ${vaults.length} vault(s)...`);
  const port = await deps.daemonPort();
  if (port !== null) {
    for (const vault of vaults) {
      deps.log(`${vault}...`);
      report(deps.log, await deps.runViaDaemon(port, vault));
    }
    return;
  }
  for (const target of gitTargets) {
    deps.log(`${target.vault}...`);
    report(deps.log, await deps.runGitInProcess(target));
  }
  for (const vault of couchVaults) {
    deps.log(`${vault}...`);
    report(deps.log, await deps.runCouchInProcess(vault));
  }
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
  runGitInProcess: runSyncCycle,
  runCouchInProcess: (vault) => createCouchSyncManager().runNow(vault),
  log: (msg) => console.log(msg),
});
