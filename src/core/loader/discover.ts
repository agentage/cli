import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isRecord } from '../../lib/fs/json-file.js';
import { manifestInfo, manifestProblem, type ManifestInfo } from './manifest.js';

export type ModuleSource = 'tree' | 'dev';

export interface DiscoveredModule {
  pkg: string;
  source: ModuleSource;
  dir: string;
  version: string | null;
  id: string | null;
  // Resolved as a path only; discovery never imports it.
  entry: string | null;
  commands: string[];
  peers: string[];
  optionalPeers: string[];
  problem: string | null;
  missing: boolean;
}

export interface DiscoverInput {
  modulesDir: string;
  names: string[];
  dev: Record<string, string>;
}

export interface Discovery {
  modules: DiscoveredModule[];
  warnings: string[];
}

export interface CurrentTree {
  dir: string | null;
  warning: string | null;
}

export interface DiscoverDeps {
  readText: (path: string) => string | null;
  exists: (path: string) => boolean;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
};

const defaultDeps: DiscoverDeps = { readText, exists: existsSync };

const TREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const readManifest = (dir: string, deps: DiscoverDeps): Record<string, unknown> | null => {
  const raw = deps.readText(join(dir, 'package.json'));
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

// `modules/current` names the tree; one without its `.complete` marker was never finished.
export const currentTree = (modulesDir: string, deps: DiscoverDeps = defaultDeps): CurrentTree => {
  const name = deps.readText(join(modulesDir, 'current'))?.trim() ?? '';
  if (name === '') return { dir: null, warning: null };
  if (!TREE_NAME.test(name)) return { dir: null, warning: `modules/current: bad tree "${name}"` };
  const dir = join(modulesDir, 'trees', name);
  if (deps.exists(join(dir, '.complete'))) return { dir, warning: null };
  return { dir: null, warning: `modules tree "${name}" is incomplete and was ignored` };
};

const inside = (dir: string, entry: string): string | null => {
  const path = resolve(dir, entry);
  const rel = relative(dir, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : path;
};

const entryProblem = (
  info: ManifestInfo,
  path: string | null,
  deps: DiscoverDeps
): string | null => {
  if (info.entry === null) return null;
  if (path === null) return `entry ${info.entry} is outside the package`;
  return deps.exists(path) ? null : `entry ${info.entry} not found`;
};

const blank = (pkg: string, source: ModuleSource, dir: string): DiscoveredModule => ({
  pkg,
  source,
  dir,
  version: null,
  id: null,
  entry: null,
  commands: [],
  peers: [],
  optionalPeers: [],
  problem: null,
  missing: false,
});

const inspect = (
  pkg: string,
  source: ModuleSource,
  dir: string | null,
  deps: DiscoverDeps
): DiscoveredModule => {
  const base = blank(pkg, source, dir ?? '');
  if (source === 'dev' && !isAbsolute(base.dir))
    return { ...base, problem: 'dev path not absolute' };
  const manifest = dir === null ? null : readManifest(dir, deps);
  if (dir === null || manifest === null) return { ...base, missing: true };
  const info = manifestInfo(manifest);
  const entry = info.entry === null ? null : inside(dir, info.entry);
  const problem = manifestProblem(pkg, info) ?? entryProblem(info, entry, deps);
  const { version, id, commands, peers, optionalPeers } = info;
  return { ...base, version, id, entry, commands, peers, optionalPeers, problem };
};

// Every claimant of a shared id is invalid; a dev copy of the same package never reaches here.
const markDuplicates = (modules: DiscoveredModule[]): DiscoveredModule[] =>
  modules.map((p) => {
    const others = modules.filter((o) => o !== p && p.id !== null && o.id === p.id);
    if (others.length === 0 || p.problem) return p;
    return {
      ...p,
      problem: `duplicate id "${p.id}" (also ${others.map((o) => o.pkg).join(', ')})`,
    };
  });

// A peer counts as a module unless the tree holds it as a plain library without `agentage`.
const modulePeers = (
  p: DiscoveredModule,
  known: Set<string>,
  nodeModules: string | null,
  deps: DiscoverDeps
): string[] =>
  p.peers.filter((peer) => {
    if (known.has(peer) || nodeModules === null) return true;
    const manifest = readManifest(join(nodeModules, peer), deps);
    return manifest === null || isRecord(manifest['agentage']);
  });

export const discover = (input: DiscoverInput, deps: DiscoverDeps = defaultDeps): Discovery => {
  const tree = currentTree(input.modulesDir, deps);
  const nodeModules = tree.dir === null ? null : join(tree.dir, 'node_modules');
  const installed = input.names.filter((name) => !(name in input.dev));
  const found = markDuplicates([
    ...installed.map((name) => inspect(name, 'tree', nodeModules && join(nodeModules, name), deps)),
    ...Object.entries(input.dev).map(([name, path]) => inspect(name, 'dev', path, deps)),
  ]);
  const known = new Set(found.map((p) => p.pkg));
  const modules = found.map((p) => ({ ...p, peers: modulePeers(p, known, nodeModules, deps) }));
  return { modules, warnings: tree.warning === null ? [] : [tree.warning] };
};
