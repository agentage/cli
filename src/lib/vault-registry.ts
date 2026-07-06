import { existsSync, mkdirSync } from 'node:fs';
import {
  expandPath,
  isAccountVault,
  validateConfig,
  type VaultEntry,
  type VaultsConfig,
} from '@agentage/memory-core';
import { isValidVaultName } from './vaults.schema.js';

// Offline registry operations over the unified vaults.json (object map keyed by name). No
// network here: account (agentage channel), local (--local) and git-origin (--git) entries.

export type VaultType = 'account' | 'git' | 'local' | 'remote';

// The human-facing type of an entry: an agentage origin is an account vault (local mirror +
// cloud channel); otherwise a path with an external origin is git, a bare path is local, and an
// origin without a path is remote.
export const vaultType = (entry: VaultEntry): VaultType => {
  if (isAccountVault(entry)) return 'account';
  if (entry.path) return entry.origin?.length ? 'git' : 'local';
  return 'remote';
};

// A local vault's markdown directory is created on `vault add` (~ is expanded).
export const ensureVaultDir = (path: string): void => {
  const dir = expandPath(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

export const formatVaultLine = (name: string, entry: VaultEntry): string => {
  const kind = vaultType(entry);
  const where = entry.path ? expandPath(entry.path) : (entry.origin?.[0]?.remote ?? '');
  // Only an external git remote is worth echoing; the account channel is implied by the type.
  const remote = kind === 'git' && entry.origin?.length ? `  <- ${entry.origin[0]!.remote}` : '';
  return `${name.padEnd(16)} ${kind.padEnd(8)} ${where}${remote}`;
};

// Add an entry under `name`; the first vault added also becomes the `default`.
export const addVault = (config: VaultsConfig, name: string, entry: VaultEntry): VaultsConfig => {
  if (!isValidVaultName(name)) throw new Error(`invalid vault name: ${JSON.stringify(name)}`);
  const vaults = config.vaults ?? {};
  if (vaults[name]) throw new Error(`vault '${name}' already exists`);
  return validateConfig({
    ...config,
    default: config.default ?? name,
    vaults: { ...vaults, [name]: entry },
  });
};

// Remove an entry; if it was the `default`, reassign to a remaining vault or drop the field.
export const removeVault = (config: VaultsConfig, name: string): VaultsConfig => {
  const vaults = config.vaults ?? {};
  if (!vaults[name]) throw new Error(`vault '${name}' not found`);
  const rest = { ...vaults };
  delete rest[name];
  const next: VaultsConfig = { ...config, vaults: rest };
  if (config.default === name) {
    const fallback = Object.keys(rest)[0];
    if (fallback) next.default = fallback;
    else delete next.default;
  }
  return validateConfig(next);
};
