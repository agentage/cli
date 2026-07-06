import chalk from 'chalk';
import { type Command } from 'commander';
import { type VaultEntry, type VaultsConfig } from '@agentage/memory-core';
import { addVault, ensureVaultDir, formatVaultLine, removeVault } from '../lib/vault-registry.js';
import { loadVaultsConfig, saveVaultsConfig, type LoadedVaults } from '../lib/vaults.js';

export interface VaultDeps {
  load: () => LoadedVaults;
  save: (config: VaultsConfig) => string;
  ensureDir: (path: string) => void;
  log: (msg: string) => void;
}

const defaultDeps: VaultDeps = {
  load: loadVaultsConfig,
  save: saveVaultsConfig,
  ensureDir: ensureVaultDir,
  log: (msg) => console.log(msg),
};

export interface VaultAddOptions {
  // `--local [path]`: true when the flag is present without a value.
  local?: string | boolean;
  git?: string;
}

const buildEntry = (name: string, opts: VaultAddOptions): VaultEntry => {
  const hasLocal = opts.local !== undefined;
  if (hasLocal && opts.git) throw new Error('choose one of --local or --git, not both');
  if (opts.git) return { origin: [{ remote: opts.git }], mcp: ['local'] };
  if (hasLocal) {
    const path = typeof opts.local === 'string' ? opts.local : `~/vaults/${name}`;
    return { path, mcp: ['local'] };
  }
  throw new Error('a vault needs --local [path] (a local folder) or --git <remote>');
};

export const runVaultAdd = (
  name: string,
  opts: VaultAddOptions,
  deps: VaultDeps = defaultDeps
): void => {
  const entry = buildEntry(name, opts);
  const config = addVault(deps.load().config, name, entry);
  if (entry.path) deps.ensureDir(entry.path);
  deps.save(config);
  const kind = entry.path ? 'local' : 'remote';
  const where = entry.path ?? entry.origin?.[0]?.remote ?? '';
  deps.log(chalk.green(`Added vault '${name}' (${kind}) -> ${where}`));
};

export const runVaultRemove = (name: string, deps: VaultDeps = defaultDeps): void => {
  const { config } = deps.load();
  const wasDefault = config.default === name;
  const next = removeVault(config, name);
  deps.save(next);
  deps.log(`Removed vault '${name}' (files left on disk).`);
  if (wasDefault && next.default) deps.log(`Default vault is now '${next.default}'.`);
};

export const runVaultList = (opts: { json?: boolean }, deps: VaultDeps = defaultDeps): void => {
  const { config } = deps.load();
  const vaults = config.vaults ?? {};
  const names = Object.keys(vaults);
  if (opts.json) {
    deps.log(JSON.stringify(vaults, null, 2));
    return;
  }
  if (names.length === 0) {
    deps.log('No vaults registered. Add one with `agentage vault add <name> --local`.');
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
    .option('--local [path]', 'a local folder (default ~/vaults/<name>)')
    .option('--git <remote>', 'a vault synced to an external git remote')
    .action((name: string, opts: VaultAddOptions) => guard(() => runVaultAdd(name, opts)));

  vault
    .command('remove <name>')
    .description('Unregister a vault (files stay on disk)')
    .action((name: string) => guard(() => runVaultRemove(name)));
};
