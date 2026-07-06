import chalk from 'chalk';
import { type Command } from 'commander';
import { isAccountVault, type VaultEntry, type VaultsConfig } from '@agentage/memory-core';
import {
  addVault,
  appendDiscoverIgnore,
  ensureVaultDir,
  formatVaultLine,
  removeVault,
  vaultType,
} from '../lib/vault-registry.js';
import {
  defaultProvisionDeps,
  provisionAccountVault,
  type ProvisionResult,
} from '../lib/provision.js';
import { loadVaultsConfig, saveVaultsConfig, type LoadedVaults } from '../lib/vaults.js';
import { defaultVaultSyncDeps, runVaultSync } from './vault-sync.js';

export interface VaultDeps {
  load: () => LoadedVaults;
  save: (config: VaultsConfig) => string;
  ensureDir: (path: string) => void;
  provision: (name: string) => Promise<ProvisionResult>;
  log: (msg: string) => void;
}

const defaultDeps: VaultDeps = {
  load: loadVaultsConfig,
  save: saveVaultsConfig,
  ensureDir: ensureVaultDir,
  provision: (name) => provisionAccountVault(name, defaultProvisionDeps()),
  log: (msg) => console.log(msg),
};

export interface VaultAddOptions {
  // `--local [path]`: true when the flag is present without a value.
  local?: string | boolean;
  git?: string;
  // `--path <dir>`: a custom local mirror dir for the account vault (no --local/--git).
  path?: string;
}

const buildEntry = (name: string, opts: VaultAddOptions): VaultEntry => {
  const hasLocal = opts.local !== undefined;
  if (hasLocal && opts.git) throw new Error('choose one of --local or --git, not both');
  if (opts.path !== undefined && (hasLocal || opts.git))
    throw new Error('--path applies only to an account vault (drop --local and --git)');
  // A --git vault is a local working copy that syncs to an external git remote (path + origin);
  // the daemon commits/pushes and pulls it per its interval.
  if (opts.git) return { path: `~/vaults/${name}`, origin: [{ remote: opts.git }], mcp: ['local'] };
  if (hasLocal) {
    const path = typeof opts.local === 'string' ? opts.local : `~/vaults/${name}`;
    return { path, mcp: ['local'] };
  }
  // No --local/--git: an account vault - a local mirror synced to the account (agentage) channel.
  return { path: opts.path ?? `~/vaults/${name}`, origin: [{ remote: 'agentage' }] };
};

export const runVaultAdd = async (
  name: string,
  opts: VaultAddOptions,
  deps: VaultDeps = defaultDeps
): Promise<void> => {
  const entry = buildEntry(name, opts);
  const config = addVault(deps.load().config, name, entry);
  if (entry.path) deps.ensureDir(entry.path);
  deps.save(config);
  const kind = vaultType(entry);
  const where = entry.path ?? entry.origin?.[0]?.remote ?? '';
  const via = kind === 'git' && entry.origin?.length ? ` <- ${entry.origin[0]!.remote}` : '';
  deps.log(chalk.green(`Added vault '${name}' (${kind}) -> ${where}${via}`));
  // Offline-first: the local entry is saved first; provisioning the account channel is never fatal.
  if (isAccountVault(entry)) deps.log((await deps.provision(name)).message);
};

export const runVaultRemove = (name: string, deps: VaultDeps = defaultDeps): void => {
  const { config } = deps.load();
  const wasDefault = config.default === name;
  const path = config.vaults?.[name]?.path;
  let next = removeVault(config, name);
  // V8: keep the removal and the ignore in one atomic save, else the next scan re-adds the folder.
  const ignored = path ? appendDiscoverIgnore(next, name, path) : null;
  if (ignored) next = ignored.config;
  deps.save(next);
  deps.log(`Removed vault '${name}' (files left on disk).`);
  if (ignored) deps.log(`Added '${name}' to ${ignored.root} ignore so it is not re-discovered.`);
  if (wasDefault && next.default) deps.log(`Default vault is now '${next.default}'.`);
};

export const runVaultList = (opts: { json?: boolean }, deps: VaultDeps = defaultDeps): void => {
  const { config } = deps.load();
  const vaults = config.vaults ?? {};
  const names = Object.keys(vaults);
  if (opts.json) {
    // Backward-compatible: still the name-keyed map, each entry annotated with its honest type.
    const out = Object.fromEntries(
      names.map((n) => [n, { ...vaults[n]!, type: vaultType(vaults[n]!) }])
    );
    deps.log(JSON.stringify(out, null, 2));
    return;
  }
  if (names.length === 0) {
    deps.log('No vaults registered. Add one with `agentage vault add <name>`.');
    return;
  }
  for (const name of names) {
    const suffix = name === config.default ? '  (default)' : '';
    deps.log(formatVaultLine(name, vaults[name]!) + suffix);
  }
};

const guard = (fn: () => void): void => {
  try {
    fn();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
};

const guardAsync = (fn: () => Promise<void>): Promise<void> =>
  fn().catch((err: unknown) => {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  });

export const registerVault = (program: Command): void => {
  const vault = program.command('vault').description('Manage local memory vaults');

  vault
    .command('list')
    .description('List registered vaults')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => guard(() => runVaultList(opts)));

  vault
    .command('add <name>')
    .description('Register a vault (account by default; --local or --git for a self-hosted one)')
    .option('--local [path]', 'a local folder (default ~/vaults/<name>)')
    .option('--git <remote>', 'a vault synced to an external git remote')
    .option('--path <dir>', 'account vault local mirror dir (default ~/vaults/<name>)')
    .action((name: string, opts: VaultAddOptions) => guardAsync(() => runVaultAdd(name, opts)));

  vault
    .command('remove <name>')
    .description('Unregister a vault (files stay on disk)')
    .action((name: string) => guard(() => runVaultRemove(name)));

  vault
    .command('sync [name]')
    .description('Sync vaults now (git commit/push/pull, or the account channel)')
    .action((name: string | undefined) =>
      runVaultSync(name, defaultVaultSyncDeps()).catch((err: unknown) => {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      })
    );
};
