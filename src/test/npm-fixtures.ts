/**
 * npm played against fixtures/ for the unit tests of the installer, `setup` and `extension
 * install`: what a registry serving the fixture extensions, plus the versions a test publishes,
 * would install or report.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Npm, type NpmCommand, type NpmManifest } from '../core/installer/npm.js';
import { newestFirst, satisfies } from '../core/semver-range.js';
import { fixture } from './config-dir.js';

type Manifest = Record<string, unknown> & { name: string; version: string };

// Published besides fixtures/, by package name: version -> the fields its package.json changes,
// e.g. { '@agentage/fixture-hello': { '1.0.1': {}, '2.0.0': { engines: { agentage: '^2' } } } }.
export type Publishes = Record<string, Record<string, Record<string, unknown>>>;

const fixtureManifest = (name: string): Manifest | null => {
  const path = join(fixture(name), 'package.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Manifest) : null;
};

// Every version the registry has for `name`, as its package.json.
const versionsOf = (name: string, more: Publishes): Manifest[] => {
  const base = fixtureManifest(name);
  const published = Object.entries(more[name] ?? {}).map(([version, fields]): Manifest => ({
    ...(base ?? { name }),
    ...fields,
    name,
    version,
  }));
  return [...(base ? [base] : []), ...published];
};

// The newest version a range allows (any, for null), as npm picks it.
const newest = (name: string, range: string | null, more: Publishes): Manifest | null =>
  versionsOf(name, more)
    .filter((m) => range === null || satisfies(m.version, range))
    .sort((a, b) => newestFirst(a.version, b.version))[0] ?? null;

const failed = (code: string, text: string) => ({
  code: 1,
  stdout: '',
  stderr: `npm error code ${code}\nnpm error ${text}`,
});

const integrity = (m: Manifest): string =>
  `sha512-${createHash('sha512').update(JSON.stringify(m)).digest('base64')}`;

const lockFor = (dependencies: Record<string, string>, chosen: Manifest[]): string => {
  const entries = chosen.map((m) => [
    `node_modules/${m.name}`,
    { version: m.version, integrity: integrity(m) },
  ]);
  return JSON.stringify({ packages: { '': { dependencies }, ...Object.fromEntries(entries) } });
};

interface Lock {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
}

const readLock = (tree: string): Lock | null => {
  const path = join(tree, 'package-lock.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Lock) : null;
};

const dependenciesOf = (command: NpmCommand, tree: string): Record<string, string> => {
  if (command === 'ci') return readLock(tree)?.packages['']?.dependencies ?? {};
  const manifest = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf-8')) as Manifest;
  return (manifest['dependencies'] ?? {}) as Record<string, string>;
};

// ci installs the lock; install keeps each pin the range still allows; update moves `packages`.
const picker =
  (command: NpmCommand, packages: string[], more: Publishes, lock: Lock | null) =>
  (name: string, range: string): Manifest | null => {
    const pinned = lock?.packages[`node_modules/${name}`]?.version;
    const moves = command === 'update' && (packages.length === 0 || packages.includes(name));
    const keep = pinned !== undefined && !moves && (command === 'ci' || satisfies(pinned, range));
    if (!keep) return newest(name, range, more);
    return versionsOf(name, more).find((m) => m.version === pinned) ?? null;
  };

const unpack = (tree: string, m: Manifest): void => {
  const dir = join(tree, 'node_modules', m.name);
  cpSync(fixture(m.name), dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(m, null, 2));
};

// Plays npm against fixtures/ plus `more`: unpacks what it picks and writes the lock (not for
// ci); a name with no fixture fails the way a registry 404 does.
export const npmPublishing =
  (more: Publishes = {}) =>
  async (): Promise<Npm> =>
  async (command, tree, packages = []) => {
    const deps = dependenciesOf(command, tree);
    const absent = Object.keys(deps).find((name) => !existsSync(fixture(name)));
    if (absent) return failed('E404', `404 ${absent}`);
    const pick = picker(command, packages, more, readLock(tree));
    const chosen = Object.entries(deps).map(([name, range]) => pick(name, range));
    if (!chosen.every((m): m is Manifest => m !== null)) return failed('ETARGET', 'notarget');
    for (const m of chosen) unpack(tree, m);
    if (command !== 'ci') writeFileSync(join(tree, 'package-lock.json'), lockFor(deps, chosen));
    return { code: 0, stdout: `changed ${chosen.length} packages`, stderr: '' };
  };

export const npmFromFixtures = npmPublishing();

// `name@range`, or a tarball URL laid out as registries serve them: `<registry>/<name>/-/<file>`.
const specParts = (spec: string): { name: string; range: string | null } => {
  if (spec.startsWith('https:'))
    return { name: new URL(spec).pathname.slice(1).split('/-/')[0] ?? '', range: null };
  const at = spec.indexOf('@', 1);
  return at === -1
    ? { name: spec, range: null }
    : { name: spec.slice(0, at), range: spec.slice(at + 1) };
};

const answer = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });

// `npm view <name>@>=0.0.0 version engines agentage.parts --json`: every release, the fields it has.
const viewed = ({ version, engines, agentage }: Manifest) => {
  const parts = (agentage as { parts?: unknown } | undefined)?.parts;
  return {
    version,
    ...(engines ? { engines } : {}),
    ...(parts ? { 'agentage.parts': parts } : {}),
  };
};

const view = (name: string, more: Publishes) => {
  const all = versionsOf(name, more);
  if (all.length === 0) return failed('E404', `404 Not Found - ${name}`);
  return answer(all.map(viewed));
};

// Plays `npm pack <spec> --dry-run --json` and `npm view`: the fixtures plus `more` are published.
export const manifestFromFixtures =
  (more: Publishes = {}) =>
  async (): Promise<NpmManifest> =>
  async (command, spec) => {
    const { name, range } = specParts(spec);
    if (command === 'view') return view(name, more);
    if (versionsOf(name, more).length === 0) return failed('E404', `404 Not Found - ${name}`);
    const found = newest(name, range, more);
    if (found === null) return failed('ETARGET', `notarget No matching version found for ${spec}.`);
    return answer([{ name, version: found.version }]);
  };
