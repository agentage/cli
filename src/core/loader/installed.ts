import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { packageDir } from '../installer/package-dir.js';
import { inspect, type DiscoveredExtension } from './discover.js';

export const installationPath = (): string => join(getConfigDir(), 'installation.json');

// The package folder of one C3 row: its source folder, or the tree its version installed to.
const dirOf = (row: Record<string, unknown>): { dir: string; dev: boolean } | null => {
  if (typeof row['source'] === 'string') return { dir: row['source'], dev: true };
  const { id, version } = row;
  if (typeof id !== 'string' || typeof version !== 'string') return null;
  const dir = packageDir(id, version);
  return dir === null ? null : { dir, dev: false };
};

const discovered = (row: unknown): DiscoveredExtension[] => {
  const found = isRecord(row) && row['enabled'] !== false ? dirOf(row) : null;
  if (found === null) return [];
  const name = readJson(join(found.dir, 'package.json'), isRecord)?.['name'];
  const pkg = typeof name === 'string' ? name : String((row as Record<string, unknown>)['id']);
  const ext = inspect({ pkg, source: found.dev ? 'dev' : 'tree', dir: found.dir }, {});
  return ext.missing || ext.problem ? [] : [ext];
};

// What installation.json runs, read from the files (no daemon is asked); null before the move.
export const installedExtensions = (): DiscoveredExtension[] | null => {
  if (!existsSync(installationPath())) return null;
  const doc = readJson(installationPath(), isRecord);
  const rows = Array.isArray(doc?.['extensions']) ? doc['extensions'] : [];
  return rows.flatMap(discovered);
};
