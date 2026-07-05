import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ensureConfigDir, getConfigDir } from './config.js';
import { VAULTS_SCHEMA_URL, VaultsConfig } from './vaults.schema.js';

export const vaultsJsonPath = (): string => join(getConfigDir(), 'vaults.json');
export const vaultsYamlPath = (): string => join(getConfigDir(), 'vaults.yaml');

const EMPTY: VaultsConfig = { version: 1, discover: [], vaults: [] };

export interface LoadedVaults {
  config: VaultsConfig;
  // the file read, or null when none exists (zero-config)
  source: string | null;
}

const readRaw = (): { text: string; path: string } | null => {
  const jsonPath = vaultsJsonPath();
  if (existsSync(jsonPath)) return { text: readFileSync(jsonPath, 'utf-8'), path: jsonPath };
  const yamlPath = vaultsYamlPath();
  if (existsSync(yamlPath)) return { text: readFileSync(yamlPath, 'utf-8'), path: yamlPath };
  return null;
};

// No legacy migration: a file that is not the current array schema fails validation
// loudly (start fresh with the new schema / `vault add`).
export const loadVaultsConfig = (): LoadedVaults => {
  const raw = readRaw();
  if (!raw) return { config: EMPTY, source: null };
  const parsed: unknown = raw.path.endsWith('.yaml') ? parseYaml(raw.text) : JSON.parse(raw.text);
  return { config: VaultsConfig.parse(parsed), source: raw.path };
};

// Scaffold an empty, $schema-linked vaults.json when none exists yet, so a fresh machine
// always has an editable file with editor autocomplete. Leaves any existing file untouched
// (it is validated on actual use, not here). Safe to call on every connect.
export const ensureVaultsConfig = (): void => {
  if (readRaw()) return;
  saveVaultsConfig(EMPTY);
};

// Atomic 0600 write of the canonical array shape, always to vaults.json (never .yaml).
export const saveVaultsConfig = (config: VaultsConfig): string => {
  ensureConfigDir();
  const path = vaultsJsonPath();
  const out = {
    $schema: VAULTS_SCHEMA_URL,
    version: config.version,
    discover: config.discover,
    vaults: config.vaults,
  };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return path;
};
