import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { installedDir } from '../installer/old-tree.js';
import { type ConfigMap } from '../profile/schema.js';
import { inspect, type DiscoveredExtension } from './discover.js';
import { onlyKitRange } from './manifest.js';

export const installationPath = (): string => join(getConfigDir(), 'installation.json');
export const settingsPath = (): string => join(getConfigDir(), 'settings.json');

// The C3 rows as written; an absent or unreadable file has none.
const rows = (): unknown[] => {
  const doc = readJson(installationPath(), isRecord);
  return Array.isArray(doc?.['extensions']) ? doc['extensions'] : [];
};

// The package folder of one C3 row: its source folder, or the tree that holds its version.
const dirOf = (row: Record<string, unknown>): { dir: string; dev: boolean } | null => {
  if (typeof row['source'] === 'string') return { dir: row['source'], dev: true };
  const { id, version } = row;
  if (typeof id !== 'string' || typeof version !== 'string') return null;
  const dir = installedDir(id, version);
  return dir === null ? null : { dir, dev: false };
};

// The daemon's settings by id: what a 1.0-API extension's ctx.config holds.
const settings = (): ConfigMap => {
  const all = readJson(settingsPath(), isRecord) ?? {};
  return Object.fromEntries(
    Object.entries(all).filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]))
  );
};

// The versions of id that installation.json names now.
export const versionsInUse = (id: string): string[] =>
  rows().flatMap((row) =>
    isRecord(row) && row['id'] === id && typeof row['version'] === 'string' ? [row['version']] : []
  );

// Each row's id and package folder, disabled ones too (null: its version is on no disk here).
export const installationRows = (): { id: string; dir: string | null }[] =>
  rows().flatMap((row) =>
    isRecord(row) && typeof row['id'] === 'string'
      ? [{ id: row['id'], dir: dirOf(row)?.dir ?? null }]
      : []
  );

const discovered = (row: unknown, configs: ConfigMap): DiscoveredExtension[] => {
  const found = isRecord(row) && row['enabled'] !== false ? dirOf(row) : null;
  if (found === null) return [];
  const name = readJson(join(found.dir, 'package.json'), isRecord)?.['name'];
  const pkg = typeof name === 'string' ? name : String((row as Record<string, unknown>)['id']);
  const ext = inspect({ pkg, source: found.dev ? 'dev' : 'tree', dir: found.dir }, configs);
  if (ext.missing || (ext.problem && !onlyKitRange(ext.problem))) return [];
  return [{ ...ext, problem: null }];
};

// What installation.json runs, read from the files (no daemon is asked); null before the move.
export const installedExtensions = (): DiscoveredExtension[] | null => {
  if (!existsSync(installationPath())) return null;
  const configs = settings();
  return rows().flatMap((row) => discovered(row, configs));
};
