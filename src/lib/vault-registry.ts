import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
import { Vault, VaultsConfig } from './vaults.schema.js';

// Offline registry operations over an in-memory VaultsConfig: no network, no provisioning.
// The couchdb (account) path lives in a later slice - these cover local + git vaults.

export const expandHome = (p: string): string =>
  p.startsWith('~/') ? join(process.env['HOME'] || homedir(), p.slice(2)) : p;

export const indexDir = (): string => join(getConfigDir(), 'index');
export const indexDbPath = (name: string): string => join(indexDir(), `${name}.db`);

// The markdown directory is created on `vault add` if missing (~ is expanded).
export const ensureVaultDir = (path: string): void => {
  const dir = expandHome(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

// The index is a rebuildable cache: dropping it on remove never touches the markdown.
export const removeIndexDb = (name: string): void => {
  const db = indexDbPath(name);
  if (existsSync(db)) rmSync(db, { force: true });
};

export const formatVaultLine = (v: Vault): string => {
  const extra =
    v.type === 'git' ? `  <- ${v.remote}` : v.type === 'couchdb' ? `  (${v.server})` : '';
  return `${v.name.padEnd(16)} ${v.type.padEnd(8)} ${v.path}${extra}`;
};

export const addVault = (
  config: VaultsConfig,
  entry: unknown
): { config: VaultsConfig; vault: Vault } => {
  const vault = Vault.parse(entry);
  if (config.vaults.some((v) => v.name === vault.name))
    throw new Error(`vault '${vault.name}' already exists`);
  return { config: VaultsConfig.parse({ ...config, vaults: [...config.vaults, vault] }), vault };
};

export const removeVault = (config: VaultsConfig, name: string): VaultsConfig => {
  if (!config.vaults.some((v) => v.name === name)) throw new Error(`vault '${name}' not found`);
  return VaultsConfig.parse({ ...config, vaults: config.vaults.filter((v) => v.name !== name) });
};
