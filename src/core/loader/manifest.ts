import { isRecord } from '../../lib/fs/json-file.js';
import { EXTENSION_API_VERSION } from '../../extension.js';
import { isRange, satisfies } from '../semver-range.js';

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const DEFAULT_ENGINE = '^1';

const CORE_COMMANDS = ['setup', 'status', 'update', 'extension', 'add', 'remove', 'help'];
const DEVICE_NAMES = ['con', 'prn', 'aux', 'nul'].concat(
  ...Array.from({ length: 10 }, (_, n) => [`com${n}`, `lpt${n}`])
);
const RESERVED_IDS: ReadonlySet<string> = new Set([...CORE_COMMANDS, ...DEVICE_NAMES]);
const SUBCOMMAND = /^[a-z0-9][a-z0-9-]*$/;

export interface ManifestInfo {
  name: string | null;
  version: string | null;
  id: string | null;
  engine: string;
  entry: string | null;
  commands: string[];
  peers: string[];
  optionalPeers: string[];
  // Read as data; checked against the profile's config by checkConfig.
  configuration: Record<string, unknown>;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const fromConditions = (value: unknown, depth = 0): string | null => {
  if (typeof value === 'string') return value;
  if (!isRecord(value) || depth > 3) return null;
  return fromConditions(value['import'], depth + 1) ?? fromConditions(value['default'], depth + 1);
};

// Node semantics: a present `exports` field is authoritative, `main` only applies without it.
const entryOf = (pkg: Record<string, unknown>): string | null => {
  const exp = pkg['exports'];
  if (exp === undefined) return str(pkg['main']);
  if (isRecord(exp) && '.' in exp) return fromConditions(exp['.']);
  const subpathsOnly = isRecord(exp) && Object.keys(exp).some((key) => key.startsWith('.'));
  return subpathsOnly ? null : fromConditions(exp);
};

const optionalPeersOf = (meta: Record<string, unknown>): string[] =>
  Object.entries(meta)
    .filter(([, m]) => isRecord(m) && m['optional'] === true)
    .map(([name]) => name);

export const manifestInfo = (pkg: Record<string, unknown>): ManifestInfo => {
  const agentage = record(pkg['agentage']);
  return {
    name: str(pkg['name']),
    version: str(pkg['version']),
    id: str(agentage['id']),
    engine: str(record(pkg['engines'])['agentage']) ?? DEFAULT_ENGINE,
    entry: entryOf(pkg),
    commands: [...new Set(strings(record(agentage['contributes'])['commands']))],
    peers: Object.keys(record(pkg['peerDependencies'])),
    optionalPeers: optionalPeersOf(record(pkg['peerDependenciesMeta'])),
    configuration: record(agentage['configuration']),
  };
};

const idProblem = (id: string | null): string | null => {
  if (id === null) return 'agentage.id is missing';
  if (!ID_PATTERN.test(id)) return `agentage.id "${id}" must match [a-z][a-z0-9-]*`;
  return RESERVED_IDS.has(id) ? `agentage.id "${id}" is reserved` : null;
};

const engineProblem = (engine: string, api: string): string | null => {
  if (!isRange(engine)) return `engines.agentage "${engine}" is not a supported range`;
  if (satisfies(api, engine)) return null;
  return `engines.agentage "${engine}" does not match extension API ${api}`;
};

// Commands are named after the id, so no two extensions, nor the core, can claim one.
const commandsProblem = (id: string, commands: string[]): string | null => {
  const ownSub = (name: string) =>
    name.startsWith(`${id}:`) && SUBCOMMAND.test(name.slice(id.length + 1));
  const bad = commands.find((name) => name !== id && !ownSub(name));
  if (bad === undefined) return null;
  return `agentage.contributes.commands: "${bad}" must be "${id}" or "${id}:<name>"`;
};

// Static checks only: the manifest is read as data and the entry is never imported.
export const manifestProblem = (
  pkg: string,
  info: ManifestInfo,
  api: string = EXTENSION_API_VERSION
): string | null => {
  if (info.name !== pkg) return `package.json name ${JSON.stringify(info.name)} is not ${pkg}`;
  return (
    idProblem(info.id) ??
    engineProblem(info.engine, api) ??
    (info.entry === null ? 'no entry point (exports or main)' : null) ??
    commandsProblem(info.id ?? '', info.commands)
  );
};
