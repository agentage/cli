import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { extensionsDir } from '../paths.js';
import { lastLines, type Npm } from './npm.js';
import {
  clearStaging,
  commitTree,
  discardTree,
  isComplete,
  manifestText,
  npmrcText,
  stageTree,
  treePath,
  withInstallLock,
} from './tree.js';

// One npm tree per extension version: a running child keeps its folder while a new one installs.
export const packagesDir = (): string => join(extensionsDir(), 'packages');

const treeName = (id: string, version: string): string => `${id}@${version}`;

export interface PackageSpec {
  id: string;
  name: string;
  version: string;
  registries: Record<string, string>;
}

// The installed package folder of id@version, or null when that tree was never finished.
export const packageDir = (id: string, version: string): string | null => {
  const root = packagesDir();
  if (!isComplete(root, treeName(id, version))) return null;
  const tree = treePath(root, treeName(id, version));
  const deps = readJson(join(tree, 'package.json'), isRecord)?.['dependencies'];
  const name = isRecord(deps) ? Object.keys(deps)[0] : undefined;
  return name === undefined ? null : join(tree, 'node_modules', name);
};

const installTree = async (spec: PackageSpec, npm: Npm): Promise<void> => {
  const root = packagesDir();
  clearStaging(root);
  const manifest = manifestText({ [spec.name]: spec.version });
  const staging = stageTree(root, { manifest, npmrc: npmrcText(spec.registries), lock: null });
  const res = await npm('install', staging);
  if (res.code !== 0) {
    discardTree(staging);
    const why = lastLines(res.stderr.trim() === '' ? res.stdout : res.stderr);
    throw new Error(`npm install ${spec.name}@${spec.version} failed (exit ${res.code})\n${why}`);
  }
  commitTree(root, staging, treeName(spec.id, spec.version));
};

// Idempotent: a finished tree is reused, so a boot that calls it again needs no network.
export const installPackage = async (spec: PackageSpec, npm: Npm): Promise<string> => {
  mkdirSync(packagesDir(), { recursive: true, mode: 0o700 });
  return withInstallLock(packagesDir(), async () => {
    const have = packageDir(spec.id, spec.version);
    if (have) return have;
    await installTree(spec, npm);
    return join(
      treePath(packagesDir(), treeName(spec.id, spec.version)),
      'node_modules',
      spec.name
    );
  });
};

// The versions of id that no installation entry uses any more go; only the daemon's own trees,
// never the 0.51 tree (read-only for this cli). Called after the daemon stopped the old child.
export const prunePackages = (id: string, inUse: string[]): string[] => {
  const trees = join(packagesDir(), 'trees');
  const names = existsSync(trees) ? readdirSync(trees) : [];
  const unused = names.filter(
    (name) => name.startsWith(`${id}@`) && !inUse.includes(name.slice(id.length + 1))
  );
  for (const name of unused) rmSync(join(trees, name), { recursive: true, force: true });
  return unused;
};
