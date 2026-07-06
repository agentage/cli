import chalk from 'chalk';
import { type Command } from 'commander';
import {
  addVault,
  ensureVaultDir,
  formatVaultLine,
  removeIndexDb,
  removeVault,
} from '../lib/vault-registry.js';
import { loadVaultsConfig, saveVaultsConfig, type LoadedVaults } from '../lib/vaults.js';
import { type VaultsConfig } from '../lib/vaults.schema.js';
import { runReindex } from './reindex.js';

export interface VaultDeps {
  load: () => LoadedVaults;
  save: (config: VaultsConfig) => string;
  ensureDir: (path: string) => void;
  removeIndex: (name: string) => void;
  log: (msg: string) => void;
}

const defaultDeps: VaultDeps = {
  load: loadVaultsConfig,
  save: saveVaultsConfig,
  ensureDir: ensureVaultDir,
  removeIndex: removeIndexDb,
  log: (msg) => console.log(msg),
};

export interface VaultAddOptions {
  local?: boolean;
  git?: string;
  path?: string;
  interval?: string;
}

// Builds the loosely-typed entry; addVault runs it through the schema (fills sync defaults).
const buildEntry = (name: string, opts: VaultAddOptions): object => {
  if (opts.local && opts.git) throw new Error('choose one of --local or --git, not both');
  const path = opts.path ?? `~/vaults/${name}`;
  if (opts.git)
    return {
      name,
      path,
      type: 'git',
      remote: opts.git,
      ...(opts.interval ? { sync: { interval: opts.interval } } : {}),
    };
  if (opts.local) return { name, path, type: 'local' };
  throw new Error(
    'account (couchdb) vaults need provisioning - coming with the sync channel. For now use --local or --git <remote>.'
  );
};

export const runVaultAdd = (
  name: string,
  opts: VaultAddOptions,
  deps: VaultDeps = defaultDeps
): void => {
  const entry = buildEntry(name, opts);
  const { config, vault } = addVault(deps.load().config, entry);
  deps.ensureDir(vault.path);
  deps.save(config);
  deps.log(chalk.green(`Added vault '${vault.name}' (${vault.type}) -> ${vault.path}`));
};

export const runVaultRemove = (name: string, deps: VaultDeps = defaultDeps): void => {
  const config = removeVault(deps.load().config, name);
  deps.save(config);
  deps.removeIndex(name);
  deps.log(`Removed vault '${name}' (files left on disk).`);
};

export const runVaultList = (opts: { json?: boolean }, deps: VaultDeps = defaultDeps): void => {
  const { vaults } = deps.load().config;
  if (opts.json) {
    deps.log(JSON.stringify(vaults, null, 2));
    return;
  }
  if (vaults.length === 0) {
    deps.log('No vaults registered. Add one with `agentage vault add <name> --local`.');
    return;
  }
  for (const v of vaults) deps.log(formatVaultLine(v));
};

const guard = (fn: () => void): void => {
  try {
    fn();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
};

const guardAsync = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
};

export const registerVault = (program: Command): void => {
  const vault = program.command('vault').description('Manage local memory vaults');

  vault
    .command('list')
    .description('List registered vaults')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => guard(() => runVaultList(opts)));

  vault
    .command('add <name>')
    .description('Register a new vault (files stay on disk)')
    .option('--local', 'a local folder that never syncs')
    .option('--git <remote>', 'sync to an external git remote')
    .option('--path <dir>', 'markdown directory (default ~/vaults/<name>)')
    .option('--interval <dur>', 'git auto-sync interval (default 5m)')
    .action((name: string, opts: VaultAddOptions) => guard(() => runVaultAdd(name, opts)));

  vault
    .command('remove <name>')
    .description('Unregister a vault and drop its index (files stay)')
    .action((name: string) => guard(() => runVaultRemove(name)));

  vault
    .command('reindex [name]')
    .description('Rebuild a vault index from its markdown (all vaults if omitted)')
    .action((name: string | undefined) => guardAsync(() => runReindex(name)));
};
