import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { currentTree } from '../loader/discover.js';
import { extensionsDir } from '../paths.js';
import { packageDir } from './package-dir.js';

const names = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

// Every package folder in a node_modules, scoped ones included.
const packagesIn = (modules: string): string[] =>
  names(modules).flatMap((name) =>
    name.startsWith('@')
      ? names(join(modules, name)).map((n) => join(modules, name, n))
      : [join(modules, name)]
  );

// The package of id@version in the tree cli 0.51 installed (extensions/current), or null.
// Moved entries run from it as they are: no npm call, so the move works offline.
export const oldPackageDir = (id: string, version: string): string | null => {
  const tree = currentTree(extensionsDir()).dir;
  if (tree === null) return null;
  const match = (dir: string) => {
    const pkg = readJson(join(dir, 'package.json'), isRecord);
    const agentage = isRecord(pkg?.['agentage']) ? pkg['agentage'] : {};
    return agentage['id'] === id && pkg?.['version'] === version;
  };
  return packagesIn(join(tree, 'node_modules')).find(match) ?? null;
};

// A version on disk: the daemon's own tree first, then the 0.51 tree.
export const installedDir = (id: string, version: string): string | null =>
  packageDir(id, version) ?? oldPackageDir(id, version);
