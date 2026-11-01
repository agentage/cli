import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { PACKAGE_NAME, specProblem } from '../profile/schema.js';
import { lastLines } from './installer.js';
import { type NpmManifest } from './npm.js';

// A package goes into profile.json; a dev extension into machine.json, by its real path.
export type Resolved =
  { kind: 'package'; name: string; spec: string } | { kind: 'dev'; name: string; path: string };

export interface Found {
  name: string;
  version: string;
}

// What the registry has for one spec; null when it does not have the package.
export type Lookup = (spec: string) => Promise<Found | null>;

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
  return { kind: 'dev', name, path };
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
  return { kind: 'package', name: (await firstFound([url], url, look)).name, spec: url };
};

// `name@range`; without a range, the latest version pinned as `^<version>`.
const fromName = async (input: string, look: Lookup): Promise<Resolved> => {
  const at = input.indexOf('@', 1);
  const name = at === -1 ? input : input.slice(0, at);
  const range = at === -1 ? null : input.slice(at + 1);
  if (!PACKAGE_NAME.test(name)) throw new Error(`${input}: not a package name`);
  const problem = range === null ? null : specProblem(range);
  if (problem) throw new Error(`${input}: ${problem}`);
  const specs = candidatesFor(name).map((c) => (range === null ? c : `${c}@${range}`));
  const found = await firstFound(specs, input, look);
  return { kind: 'package', name: found.name, spec: range ?? `^${found.version}` };
};

// A local path, then refused schemes, then a tarball URL, then a package or short name.
export const resolveName = async (input: string, look: Lookup): Promise<Resolved> => {
  if (LOCAL.test(input) || isAbsolute(input)) return devExtension(input);
  const refused = refusal(input);
  if (refused) throw new Error(`${input}: ${refused}`);
  return HTTPS.test(input) ? fromUrl(input, look) : fromName(input, look);
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

// npm is prepared on the first question; E404 means absent, any other failure stops the install.
export const registryLookup = (
  prepare: () => Promise<NpmManifest>,
  registries: Record<string, string>
): Lookup => {
  let manifest: Promise<NpmManifest> | undefined;
  return async (spec) => {
    manifest ??= prepare();
    const res = await (await manifest)(spec, registries);
    if (res.code !== 0 && /\bE404\b/.test(`${res.stdout}\n${res.stderr}`)) return null;
    const found = res.code === 0 ? parseFound(res.stdout) : null;
    if (found) return found;
    // With --json, npm repeats its stderr lines as a JSON object on stdout.
    const why = lastLines(res.stderr.trim() === '' ? res.stdout : res.stderr);
    throw new Error(`npm could not read ${spec} (exit ${res.code})\n${why}`);
  };
};
