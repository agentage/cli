import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type NpmResult } from '../../lib/npm/npm-cli.js';
import { PACKAGE_NAME, specProblem } from '../profile/schema.js';
import { cliGate, needs, newestCompatible, parsePublished, type Published } from './compat.js';
import { isKitShaped } from '../loader/kit-manifest.js';
import { lastLines } from './installer.js';
import { type LookupCommand, type NpmManifest } from './npm.js';

// A package goes into profile.json; a dev extension into machine.json, by its real path.
// `skipped`: newer versions whose engines.agentage does not fit; `kit`: built on the kit.
export type Resolved =
  | { kind: 'package'; name: string; spec: string; skipped: Published[] }
  | { kind: 'dev'; name: string; path: string; kit: boolean };

export interface Found {
  name: string;
  version: string;
}

// What the registry has for one spec; null when it does not have the package.
export type Lookup = (spec: string) => Promise<Found | null>;

// Every release of a name with its engines; null when the registry does not have it.
export type Versions = (name: string) => Promise<Published[] | null>;

export interface Registry {
  find: Lookup;
  versions: Versions;
}

// Every release: a range, not `*`, which npm view reads as the `latest` tag alone.
const EVERY_RELEASE = '>=0.0.0';

const LOCAL = /^\.{1,2}(?:[/\\]|$)/;
const REFUSED = /^(npm|github|file|http):/i;
const PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;
const HTTPS = /^https:/i;
const FULL_PREFIX = 'agentage-extension-';
const INSTEAD = 'install a package name, an https: tarball URL or a local path (./path)';

// `memory` -> the two names it may be published under; any other name stands for itself.
export const candidatesFor = (name: string): string[] =>
  name.startsWith('@') || name.startsWith(FULL_PREFIX)
    ? [name]
    : [`@agentage/extension-${name}`, `${FULL_PREFIX}${name}`];

const refusal = (input: string): string | null => {
  const scheme = REFUSED.exec(input)?.[1];
  if (scheme) return `${scheme.toLowerCase()}: is refused; ${INSTEAD}`;
  return PROTOCOL.test(input) && !HTTPS.test(input) ? `unsupported; ${INSTEAD}` : null;
};

const folder = (input: string): string | null => {
  try {
    return realpathSync(resolve(input));
  } catch {
    return null;
  }
};

// Its own package.json names the package and declares agentage.id, as discovery will check.
const devExtension = (input: string): Resolved => {
  const path = folder(input);
  const manifest = path === null ? null : readJson(join(path, 'package.json'), isRecord);
  const agentage = manifest?.['agentage'];
  const name = manifest?.['name'];
  if (path === null || typeof name !== 'string' || !isRecord(agentage) || !agentage['id'])
    throw new Error(
      `${input}: not an extension folder (no package.json with a name and agentage.id)`
    );
  return { kind: 'dev', name, path, kit: isKitShaped(agentage) };
};

// The first candidate the registry has; a missing one moves on to the next.
const firstFound = async (specs: string[], input: string, look: Lookup): Promise<Found> => {
  for (const spec of specs) {
    const found = await look(spec);
    if (found) return found;
  }
  throw new Error(`${input}: not found; tried ${specs.join(', ')}`);
};

const fromUrl = async (url: string, look: Lookup): Promise<Resolved> => {
  const problem = specProblem(url);
  if (problem) throw new Error(`${url}: ${problem}`);
  const { name } = await firstFound([url], url, look);
  return { kind: 'package', name, spec: url, skipped: [] };
};

const pinned = (input: string, name: string, published: Published[]): Resolved => {
  const gate = cliGate();
  const { version, skipped } = newestCompatible(published, gate);
  if (version !== null) return { kind: 'package', name, spec: `^${version}`, skipped };
  const newest = skipped[0] === undefined ? '' : ` (${needs(skipped[0])})`;
  const api = skipped[0]?.kit ? `kit ${gate.kit}` : `extension API ${gate.api}`;
  throw new Error(`${input}: no published version works with ${api}${newest}`);
};

// The first candidate the registry has, at its newest version this CLI can load.
const compatible = async (input: string, name: string, versions: Versions) => {
  const names = candidatesFor(name);
  for (const candidate of names) {
    const published = await versions(candidate);
    if (published !== null) return pinned(input, candidate, published);
  }
  throw new Error(`${input}: not found; tried ${names.join(', ')}`);
};

// `name@range` keeps the range; without one, the newest compatible version as `^<version>`.
const fromName = async (input: string, registry: Registry): Promise<Resolved> => {
  const at = input.indexOf('@', 1);
  const name = at === -1 ? input : input.slice(0, at);
  const range = at === -1 ? null : input.slice(at + 1);
  if (!PACKAGE_NAME.test(name)) throw new Error(`${input}: not a package name`);
  const problem = range === null ? null : specProblem(range);
  if (problem) throw new Error(`${input}: ${problem}`);
  if (range === null) return compatible(input, name, registry.versions);
  const specs = candidatesFor(name).map((c) => `${c}@${range}`);
  const found = await firstFound(specs, input, registry.find);
  return { kind: 'package', name: found.name, spec: range, skipped: [] };
};

// A local path, then refused schemes, then a tarball URL, then a package or short name.
export const resolveName = async (input: string, registry: Registry): Promise<Resolved> => {
  if (LOCAL.test(input) || isAbsolute(input)) return devExtension(input);
  const refused = refusal(input);
  if (refused) throw new Error(`${input}: ${refused}`);
  return HTTPS.test(input) ? fromUrl(input, registry.find) : fromName(input, registry);
};

const parseFound = (stdout: string): Found | null => {
  try {
    const [first] = JSON.parse(stdout) as unknown[];
    const { name, version }: Record<string, unknown> = isRecord(first) ? first : {};
    return typeof name === 'string' && typeof version === 'string' ? { name, version } : null;
  } catch {
    return null;
  }
};

// E404 means absent; any other failure, or an answer that does not parse, stops the install.
const answerOf = <T>(spec: string, res: NpmResult, parse: (stdout: string) => T | null) => {
  if (res.code !== 0 && /\bE404\b/.test(`${res.stdout}\n${res.stderr}`)) return null;
  const parsed = res.code === 0 ? parse(res.stdout) : null;
  if (parsed !== null) return parsed;
  // With --json, npm repeats its stderr lines as a JSON object on stdout.
  const why = lastLines(res.stderr.trim() === '' ? res.stdout : res.stderr);
  throw new Error(`npm could not read ${spec} (exit ${res.code})\n${why}`);
};

// npm is prepared on the first question, through the registries the profile routes.
export const registryLookup = (
  prepare: () => Promise<NpmManifest>,
  registries: Record<string, string>
): Registry => {
  let manifest: Promise<NpmManifest> | undefined;
  const ask = async (command: LookupCommand, spec: string) => {
    manifest ??= prepare();
    return (await manifest)(command, spec, registries);
  };
  const versions = async (name: string) => {
    const spec = `${name}@${EVERY_RELEASE}`;
    return answerOf(spec, await ask('view', spec), parsePublished);
  };
  const find = async (spec: string) => answerOf(spec, await ask('pack', spec), parseFound);
  return { find, versions };
};
