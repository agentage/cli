import { isRecord } from '../../lib/fs/json-file.js';
import { isRange } from '../semver-range.js';

export const SCHEMA_VERSION = 1;

export type ConfigMap = Record<string, Record<string, unknown>>;

export interface MachineEntry {
  off: string[];
  config: ConfigMap;
  extra: Record<string, unknown>;
}

export interface Profile {
  version: number;
  extensions: Record<string, string>;
  // npm scope -> registry URL; unlisted scopes and unscoped names use npm's public registry.
  registries: Record<string, string>;
  config: ConfigMap;
  machines: Record<string, MachineEntry>;
  extra: Record<string, unknown>;
}

export type ProfileParse =
  | { ok: true; profile: Profile; readOnly: boolean; warnings: string[] }
  | { ok: false; errors: string[] };

interface Issues {
  errors: string[];
  warnings: string[];
}

const TOP_KEYS = ['version', 'extensions', 'registries', 'config', 'machines'];
const MACHINE_KEYS = ['off', 'config'];
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SCOPE = /^@[a-z0-9][a-z0-9._~-]*$/;
const LOOPBACK_HOST = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])$/i;
const REFUSED_PREFIX = /^(npm|github|file|http):/i;
const OTHER_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;
const LOCAL_PATH = /^(?:\.{1,2}[/\\]|~?[/\\])/;
const EMPTY_MACHINE: MachineEntry = { off: [], config: {}, extra: {} };
const USE_INSTEAD = 'use a semver range or an https: tarball URL';

const at = (name: string): string => `[${JSON.stringify(name)}]`;

const fail = <T>(issues: Issues, message: string, fallback: T): T => {
  issues.errors.push(message);
  return fallback;
};

const urlOf = (text: string): URL | null => {
  try {
    return new URL(text);
  } catch {
    return null;
  }
};

const httpsProblem = (spec: string): string | null => {
  const url = urlOf(spec);
  if (url === null) return 'is not a valid https: URL';
  return LOOPBACK_HOST.test(url.hostname) ? 'loopback URLs are refused' : null;
};

const specProblem = (spec: string): string | null => {
  const refused = REFUSED_PREFIX.exec(spec)?.[1];
  if (refused) return `${refused.toLowerCase()}: specs are refused; ${USE_INSTEAD}`;
  if (/^https:/i.test(spec)) return httpsProblem(spec);
  if (LOCAL_PATH.test(spec)) return 'local paths are dev-only and belong in machine.json';
  if (OTHER_PROTOCOL.test(spec)) return `unsupported spec; ${USE_INSTEAD}`;
  return isRange(spec) ? null : `is not a semver range; ${USE_INSTEAD}`;
};

const extensionProblem = (name: string, spec: unknown): string | null => {
  if (!PACKAGE_NAME.test(name)) return 'is not a valid package name';
  if (typeof spec !== 'string' || spec.trim() === '') return 'must be a non-empty string';
  return specProblem(spec.trim());
};

// Whitespace is refused outright: the URL lands on one line of the tree's .npmrc.
const registryProblem = (scope: string, url: unknown): string | null => {
  if (!SCOPE.test(scope)) return 'is not an npm scope (@name)';
  const parsed = typeof url === 'string' && !/\s/.test(url) ? urlOf(url) : null;
  if (parsed && (parsed.username || parsed.password)) return 'must not carry credentials';
  if (parsed?.protocol === 'https:') return null;
  if (parsed?.protocol === 'http:' && LOOPBACK_HOST.test(parsed.hostname)) return null;
  return 'must be an https: URL, or http: on a loopback host';
};

type EntryProblem = (key: string, value: unknown) => string | null;

// A map of strings: each entry is checked on its own and reported by its path.
const parseMap = (
  value: unknown,
  path: string,
  problemOf: EntryProblem,
  issues: Issues
): Record<string, string> => {
  if (value === undefined) return {};
  if (!isRecord(value)) return fail(issues, `${path}: must be an object`, {});
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const problem = problemOf(key, entry);
    if (problem) issues.errors.push(`${path}${at(key)}: ${problem}`);
    else map[key] = String(entry);
  }
  return map;
};

const parseConfig = (value: unknown, path: string, issues: Issues): ConfigMap => {
  if (value === undefined) return {};
  if (!isRecord(value)) return fail(issues, `${path}: must be an object`, {});
  const config: ConfigMap = {};
  for (const [id, slice] of Object.entries(value)) {
    if (isRecord(slice)) config[id] = slice;
    else issues.errors.push(`${path}${at(id)}: must be an object`);
  }
  return config;
};

const extraKeys = (
  doc: Record<string, unknown>,
  known: string[],
  path: string,
  issues: Issues
): Record<string, unknown> => {
  const extra = Object.fromEntries(Object.entries(doc).filter(([key]) => !known.includes(key)));
  for (const key of Object.keys(extra)) issues.warnings.push(`${path}: unknown key "${key}" kept`);
  return extra;
};

const parseOff = (value: unknown, path: string, issues: Issues): string[] => {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((name) => typeof name === 'string')) return value;
  return fail(issues, `${path}.off: must be an array of package names`, []);
};

const parseMachine = (value: unknown, path: string, issues: Issues): MachineEntry => {
  if (!isRecord(value)) return fail(issues, `${path}: must be an object`, EMPTY_MACHINE);
  return {
    off: parseOff(value['off'], path, issues),
    config: parseConfig(value['config'], `${path}.config`, issues),
    extra: extraKeys(value, MACHINE_KEYS, path, issues),
  };
};

const parseMachines = (value: unknown, issues: Issues): Record<string, MachineEntry> => {
  if (value === undefined) return {};
  if (!isRecord(value)) return fail(issues, 'machines: must be an object', {});
  return Object.fromEntries(
    Object.entries(value).map(([id, entry]) => [
      id,
      parseMachine(entry, `machines${at(id)}`, issues),
    ])
  );
};

const parseVersionField = (value: unknown, issues: Issues): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  const got = value === undefined ? 'missing' : JSON.stringify(value);
  issues.errors.push(`version: must be ${SCHEMA_VERSION} (got ${got})`);
  return SCHEMA_VERSION;
};

const readOnlyWarning = (version: number): string =>
  `version: ${version} is newer than this CLI understands (${SCHEMA_VERSION}); read-only`;

export const parseProfile = (doc: unknown): ProfileParse => {
  if (!isRecord(doc)) return { ok: false, errors: ['profile.json: must be a JSON object'] };
  const issues: Issues = { errors: [], warnings: [] };
  const profile: Profile = {
    version: parseVersionField(doc['version'], issues),
    extensions: parseMap(doc['extensions'], 'extensions', extensionProblem, issues),
    registries: parseMap(doc['registries'], 'registries', registryProblem, issues),
    config: parseConfig(doc['config'], 'config', issues),
    machines: parseMachines(doc['machines'], issues),
    extra: extraKeys(doc, TOP_KEYS, 'profile.json', issues),
  };
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors };
  const readOnly = profile.version > SCHEMA_VERSION;
  if (readOnly) issues.warnings.push(readOnlyWarning(profile.version));
  return { ok: true, profile, readOnly, warnings: issues.warnings };
};

// The inverse of parseProfile: unknown keys go back where they were found.
export const toDocument = (profile: Profile): Record<string, unknown> => ({
  version: profile.version,
  extensions: profile.extensions,
  ...(Object.keys(profile.registries).length > 0 ? { registries: profile.registries } : {}),
  config: profile.config,
  machines: Object.fromEntries(
    Object.entries(profile.machines).map(([id, m]) => [
      id,
      { off: m.off, config: m.config, ...m.extra },
    ])
  ),
  ...profile.extra,
});
