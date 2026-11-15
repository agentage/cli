import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { currentTree } from '../loader/discover.js';
import { extensionsDir } from '../paths.js';
import { packageDir, packagesDir } from './package-dir.js';

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

const manifestOf = (dir: string) => readJson(join(dir, 'package.json'), isRecord);

// The package of id (at version, when given) in the tree cli 0.51 installed, or null.
const oldPackage = (id: string, version?: string): string | null => {
  const tree = currentTree(extensionsDir()).dir;
  if (tree === null) return null;
  const match = (dir: string) => {
    const pkg = manifestOf(dir);
    const agentage = isRecord(pkg?.['agentage']) ? pkg['agentage'] : {};
    return agentage['id'] === id && (version === undefined || pkg?.['version'] === version);
  };
  return packagesIn(join(tree, 'node_modules')).find(match) ?? null;
};

// Moved entries run from the 0.51 tree as they are: no npm call, so the move works offline.
export const oldPackageDir = (id: string, version: string): string | null =>
  oldPackage(id, version);

// The npm name id was installed under here (the daemon's trees, then the 0.51 tree), or null.
export const installedName = (id: string): string | null => {
  const own = names(join(packagesDir(), 'trees'))
    .filter((tree) => tree.startsWith(`${id}@`))
    .map((tree) => packageDir(id, tree.slice(id.length + 1)))
    .find((dir) => dir !== null);
  const dir = own ?? oldPackage(id);
  const name = dir ? manifestOf(dir)?.['name'] : undefined;
  return typeof name === 'string' ? name : null;
};

// A version on disk: the daemon's own tree first, then the 0.51 tree.
export const installedDir = (id: string, version: string): string | null =>
  packageDir(id, version) ?? oldPackageDir(id, version);
