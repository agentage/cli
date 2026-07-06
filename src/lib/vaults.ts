import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig, type VaultsConfig } from '@agentage/memory-core';
import { ensureConfigDir, getConfigDir } from './config.js';
import { withFileLock } from './file-lock.js';
import { VAULTS_SCHEMA_URL } from './vaults.schema.js';

export const vaultsJsonPath = (): string => join(getConfigDir(), 'vaults.json');

const EMPTY: VaultsConfig = { version: 1, vaults: {} };

export interface LoadedVaults {
  config: VaultsConfig;
  // the file read, or null when none exists (zero-config)
  source: string | null;
}

// JSON only (one format everywhere; the standalone @agentage/server-memory reads the same file
// and parses only JSON). A missing file yields an empty config; a bad shape throws ConfigError.
export const loadVaultsConfig = (): LoadedVaults => {
  const path = vaultsJsonPath();
  if (!existsSync(path)) return { config: EMPTY, source: null };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return { config: validateConfig(raw), source: path };
};

// Scaffold an empty, $schema-linked vaults.json when none exists yet, so a fresh machine always
// has an editable file with editor autocomplete. Leaves any existing file untouched.
export const ensureVaultsConfig = (): void => {
  if (existsSync(vaultsJsonPath())) return;
  saveVaultsConfig(EMPTY);
};

// Atomic 0600 write. Re-injects the canonical $schema first and preserves every other field.
export const saveVaultsConfig = (config: VaultsConfig): string => {
  ensureConfigDir();
  const path = vaultsJsonPath();
  const out: Record<string, unknown> = { $schema: VAULTS_SCHEMA_URL, version: config.version };
  if (config.vaultsDir !== undefined) out.vaultsDir = config.vaultsDir;
  if (config.autodiscover !== undefined) out.autodiscover = config.autodiscover;
  if (config.autoInit !== undefined) out.autoInit = config.autoInit;
  if (config.default !== undefined) out.default = config.default;
  if (config.discover !== undefined) out.discover = config.discover;
  out.vaults = config.vaults ?? {};
  // A per-save tmp name: two concurrent savers can never clobber each other's tmp file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return path;
};

// Cross-process-safe read-modify-write on vaults.json (issue #231). Under the advisory lock, re-read
// FRESH from disk, apply `fn`, then atomic-save - so a concurrent `vault add` or the daemon's
// discovery write-back can never clobber each other's update. `fn` may return a new config, mutate
// the fresh one in place and return void, or return null to skip the write entirely (a no-op scan
// must not re-touch the file, else the daemon's config watcher would loop). Returns the config on
// disk after the call. A plain read stays lock-free via loadVaultsConfig.
export const mutateVaultsConfig = async (
  fn: (config: VaultsConfig) => VaultsConfig | null | void
): Promise<VaultsConfig> => {
  ensureConfigDir();
  return withFileLock(vaultsJsonPath(), () => {
    const fresh = loadVaultsConfig().config;
    const next = fn(fresh);
    if (next === null) return fresh; // explicit no-op: leave the file untouched
    const result = next ?? fresh;
    saveVaultsConfig(result);
    return result;
  });
};
