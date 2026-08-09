import chalk from 'chalk';
import { isAccountVault, type VaultsConfig } from '@agentage/memory-core';
import { health, syncRun } from '../../lib/daemon/daemon-client.js';
import { daemonDisabled } from '../../lib/daemon/daemon-pref.js';
import { loadVaultsConfig } from '../../lib/vault/vaults.js';
import { resolvePort } from '../../daemon/lifecycle.js';
import { runSyncCycle, type SyncResult } from '../../sync/git/cycle.js';
import { syncTargets, type SyncTarget } from '../../sync/git/planner.js';
import { redactRemoteUrl } from '../../sync/git/remote-url.js';

export interface VaultSyncDeps {
  loadConfig: () => VaultsConfig;
  // The port of a reachable daemon, or null to run in-process (daemon down or --no-daemon).
  daemonPort: () => Promise<number | null>;
  runViaDaemon: (port: number, vault: string) => Promise<SyncResult>;
  runGitInProcess: (target: SyncTarget) => Promise<SyncResult>;
  log: (msg: string) => void;
}

export const ACCOUNT_NO_CHANNEL = 'not synced - account vaults have no sync channel';

const describeGit = (r: SyncResult): string => {
  if (!r.ok) return chalk.red(`failed (${r.reason ?? 'error'})${r.error ? `: ${r.error}` : ''}`);
  if (r.skipped) return chalk.yellow(`skipped (${r.skipped})`);
  const bits: string[] = [];
  if (r.committed) bits.push('committed');
  if (r.conflicts.length) bits.push(`${r.conflicts.length} conflict copy(ies)`);
  if (r.pushed) bits.push('pushed');
  return chalk.green(bits.length ? bits.join(', ') : 'up to date');
};

const report = (log: (msg: string) => void, r: SyncResult): void => {
  log(`${r.vault} -> ${redactRemoteUrl(r.remote)}: ${describeGit(r)}`);
  for (const c of r.conflicts) log(`  kept remote copy: ${c}`);
};

// Account vaults whose only origin is the reserved `agentage` remote: nothing syncs them. They are
// named, never silently skipped, so `vault sync` cannot read as "everything is up to date".
const unsyncableAccountVaults = (config: VaultsConfig, gitTargets: SyncTarget[]): string[] => {
  const git = new Set(gitTargets.map((t) => t.vault));
  return Object.entries(config.vaults ?? {})
    .filter(([vault, entry]) => isAccountVault(entry) && !git.has(vault))
    .map(([vault]) => vault);
};

const reportAccounts = (log: (msg: string) => void, vaults: string[]): void => {
  for (const vault of vaults) log(`${vault} (account): ${chalk.yellow(ACCOUNT_NO_CHANNEL)}`);
};

// `agentage vault sync [name]`: sync one vault (or every syncable vault). Git-origin vaults commit
// + push + pull-rebase; account (agentage) vaults have no sync channel and are reported as such.
// Prefers a running daemon (single writer), else runs the cycle in-process. Works for interval-0
// (manual-only) vaults and with the daemon down. Failures are surfaced, not thrown (V6: never a crash).
export const runVaultSync = async (
  name: string | undefined,
  deps: VaultSyncDeps
): Promise<void> => {
  const config = deps.loadConfig();
  // A named vault that is not registered is an error (mirrors `vault remove`), not a silent no-op.
  if (name && !(config.vaults ?? {})[name]) throw new Error(`vault '${name}' not found`);
  const gitTargets = syncTargets(config).filter((t) => !name || t.vault === name);
  const accounts = unsyncableAccountVaults(config, gitTargets).filter((v) => !name || v === name);
  if (gitTargets.length === 0) {
    reportAccounts(deps.log, accounts);
    if (accounts.length === 0)
      deps.log(
        name
          ? `No syncable origin configured for vault '${name}'.`
          : 'No syncable vaults. Add one with `agentage vault add <name>`.'
      );
    return;
  }
  const vaults = [...new Set(gitTargets.map((t) => t.vault))];
  deps.log(`Syncing ${vaults.length} vault(s)...`);
  const port = await deps.daemonPort();
  if (port !== null) {
    for (const vault of vaults) {
      deps.log(`${vault}...`);
      report(deps.log, await deps.runViaDaemon(port, vault));
    }
  } else {
    for (const target of gitTargets) {
      deps.log(`${target.vault}...`);
      report(deps.log, await deps.runGitInProcess(target));
    }
  }
  reportAccounts(deps.log, accounts);
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
  log: (msg) => console.log(msg),
});
