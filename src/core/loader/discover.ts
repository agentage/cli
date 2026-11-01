import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isRecord } from '../../lib/fs/json-file.js';
import { type ConfigMap } from '../profile/schema.js';
import { checkConfig } from './config.js';
import { unsafeDevPath } from './dev-path.js';
import { manifestInfo, manifestProblem, type ManifestInfo } from './manifest.js';

export type ExtensionSource = 'tree' | 'dev';

export interface DiscoveredExtension {
  pkg: string;
  source: ExtensionSource;
  dir: string;
  version: string | null;
  id: string | null;
  // Resolved as a path only; discovery never imports it.
  entry: string | null;
  commands: string[];
  peers: string[];
  optionalPeers: string[];
  // The profile's config checked against the manifest, defaults filled; what ctx.config holds.
  config: Record<string, unknown>;
  // Keys declared `secret: true`, read through ctx.secrets.
  secrets: string[];
  // Declared `description` by key, shown when setup asks for a secret.
  descriptions: Record<string, string>;
  problem: string | null;
  missing: boolean;
}

export interface DiscoverInput {
  extensionsDir: string;
  names: string[];
  dev: Record<string, string>;
  // Effective config per extension id.
  config: ConfigMap;
}

export interface Discovery {
  extensions: DiscoveredExtension[];
  warnings: string[];
}

export interface CurrentTree {
  dir: string | null;
  warning: string | null;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
};

const TREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const readManifest = (dir: string): Record<string, unknown> | null => {
  const raw = readText(join(dir, 'package.json'));
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

// `extensions/current` names the tree; one without its `.complete` marker was never finished.
export const currentTree = (extensionsDir: string): CurrentTree => {
  const name = readText(join(extensionsDir, 'current'))?.trim() ?? '';
  if (name === '') return { dir: null, warning: null };
  if (!TREE_NAME.test(name))
    return { dir: null, warning: `extensions/current: bad tree "${name}"` };
  const dir = join(extensionsDir, 'trees', name);
  if (existsSync(join(dir, '.complete'))) return { dir, warning: null };
  return { dir: null, warning: `extensions tree "${name}" is incomplete and was ignored` };
};

const inside = (dir: string, entry: string): string | null => {
  const path = resolve(dir, entry);
  const rel = relative(dir, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : path;
};

const entryProblem = (info: ManifestInfo, path: string | null): string | null => {
  if (info.entry === null) return null;
  if (path === null) return `entry ${info.entry} is outside the package`;
  return existsSync(path) ? null : `entry ${info.entry} not found`;
};

const blank = (pkg: string, source: ExtensionSource, dir: string): DiscoveredExtension => ({
  pkg,
  source,
  dir,
  version: null,
  id: null,
  entry: null,
  commands: [],
  peers: [],
  optionalPeers: [],
  config: {},
  secrets: [],
  descriptions: {},
  problem: null,
  missing: false,
});

interface Candidate {
  pkg: string;
  source: ExtensionSource;
  dir: string | null;
}

const inspect = ({ pkg, source, dir }: Candidate, configs: ConfigMap): DiscoveredExtension => {
  const base = blank(pkg, source, dir ?? '');
  if (source === 'dev' && !isAbsolute(base.dir))
    return { ...base, problem: 'dev path not absolute' };
  const manifest = dir === null ? null : readManifest(dir);
  if (dir === null || manifest === null) return { ...base, missing: true };
  const info = manifestInfo(manifest);
  const entry = info.entry === null ? null : inside(dir, info.entry);
  const { version, id, commands, peers, optionalPeers } = info;
  const slice = configs[id ?? ''] ?? {};
  const { problem: badConfig, ...declared } = checkConfig(id ?? '', info.configuration, slice);
  const unsafe = source === 'dev' ? unsafeDevPath(dir, process.getuid?.()) : null;
  const problem = unsafe ?? manifestProblem(pkg, info) ?? entryProblem(info, entry) ?? badConfig;
  return { ...base, version, id, entry, commands, peers, optionalPeers, ...declared, problem };
};

// Every claimant of a shared id is invalid; a dev copy of the same package never reaches here.
const markDuplicates = (extensions: DiscoveredExtension[]): DiscoveredExtension[] =>
  extensions.map((p) => {
    const others = extensions.filter((o) => o !== p && p.id !== null && o.id === p.id);
    if (others.length === 0 || p.problem) return p;
    return {
      ...p,
      problem: `duplicate id "${p.id}" (also ${others.map((o) => o.pkg).join(', ')})`,
    };
  });

// A peer counts as an extension unless the tree holds it as a plain library without `agentage`.
const extensionPeers = (
  p: DiscoveredExtension,
  known: Set<string>,
  nodeModules: string | null
): string[] =>
  p.peers.filter((peer) => {
    if (known.has(peer) || nodeModules === null) return true;
    const manifest = readManifest(join(nodeModules, peer));
    return manifest === null || isRecord(manifest['agentage']);
  });

export const discover = (input: DiscoverInput): Discovery => {
  const tree = currentTree(input.extensionsDir);
  const nodeModules = tree.dir === null ? null : join(tree.dir, 'node_modules');
  const installed = input.names.filter((name) => !(name in input.dev));
  const found = markDuplicates(
    [
      ...installed.map((pkg): Candidate => ({
        pkg,
        source: 'tree',
        dir: nodeModules && join(nodeModules, pkg),
      })),
      ...Object.entries(input.dev).map(([pkg, dir]): Candidate => ({ pkg, source: 'dev', dir })),
    ].map((candidate) => inspect(candidate, input.config))
  );
  const known = new Set(found.map((p) => p.pkg));
  const extensions = found.map((p) => ({
    ...p,
    peers: extensionPeers(p, known, nodeModules),
  }));
  return { extensions, warnings: tree.warning === null ? [] : [tree.warning] };
};
