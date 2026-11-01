import { isRecord } from '../../lib/fs/json-file.js';

export interface CheckedConfig {
  // Defaults filled, unknown keys kept, secret keys left out.
  config: Record<string, unknown>;
  secrets: string[];
  // Declared `description` by key.
  descriptions: Record<string, string>;
  problem: string | null;
}

const TYPES: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: isRecord,
};

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
};

const quoted = (value: unknown): string => JSON.stringify(value);

const declarationProblem = (key: string, declared: Record<string, unknown>): string | null => {
  const type = declared['type'];
  if (typeof type !== 'string' || !TYPES[type])
    return `agentage.configuration.${key}.type must be one of ${Object.keys(TYPES).join(', ')}`;
  const allowed = declared['enum'];
  if (allowed !== undefined && !Array.isArray(allowed))
    return `agentage.configuration.${key}.enum must be an array`;
  return null;
};

// Compared as JSON, so an enum of arrays or objects works too.
const valueProblem = (name: string, declared: Record<string, unknown>, value: unknown) => {
  const type = String(declared['type']);
  if (value === undefined) return null;
  if (!TYPES[type]?.(value)) return `${name}: must be of type ${type} (got ${typeOf(value)})`;
  const allowed = declared['enum'];
  if (!Array.isArray(allowed) || allowed.some((v) => quoted(v) === quoted(value))) return null;
  return `${name}: must be one of ${allowed.map(quoted).join(', ')} (got ${quoted(value)})`;
};

const declarations = (configuration: Record<string, unknown>) =>
  Object.entries(configuration).map(([key, entry]) => ({
    key,
    declared: isRecord(entry) ? entry : {},
  }));

const descriptionsOf = (all: ReturnType<typeof declarations>): Record<string, string> =>
  Object.fromEntries(
    all.flatMap(({ key, declared }) => {
      const text = declared['description'];
      return typeof text === 'string' ? [[key, text]] : [];
    })
  );

// The profile's slice for one extension, checked against what its manifest declares.
export const checkConfig = (
  id: string,
  configuration: Record<string, unknown>,
  slice: Record<string, unknown>
): CheckedConfig => {
  const all = declarations(configuration);
  const secrets = all.filter((d) => d.declared['secret'] === true).map((d) => d.key);
  const config = Object.fromEntries(Object.entries(slice).filter(([k]) => !secrets.includes(k)));
  const descriptions = descriptionsOf(all);
  for (const { key, declared } of all.filter((d) => !secrets.includes(d.key))) {
    const value = key in slice ? slice[key] : declared['default'];
    const problem =
      declarationProblem(key, declared) ?? valueProblem(`config.${id}.${key}`, declared, value);
    if (problem) return { config: {}, secrets: [], descriptions: {}, problem };
    if (value !== undefined) config[key] = value;
  }
  return { config, secrets, descriptions, problem: null };
};
