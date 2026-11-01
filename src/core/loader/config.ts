import { isRecord } from '../../lib/fs/json-file.js';

export interface CheckedConfig {
  // Defaults filled, unknown keys kept, secret keys left out.
  config: Record<string, unknown>;
  secrets: string[];
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

const keyProblem = (id: string, key: string, type: unknown, value: unknown): string | null => {
  const check = typeof type === 'string' ? TYPES[type] : undefined;
  if (!check)
    return `agentage.configuration.${key}.type must be one of ${Object.keys(TYPES).join(', ')}`;
  if (value === undefined || check(value)) return null;
  return `config.${id}.${key}: must be of type ${String(type)} (got ${typeOf(value)})`;
};

const declarations = (configuration: Record<string, unknown>) =>
  Object.entries(configuration).map(([key, entry]) => ({
    key,
    declared: isRecord(entry) ? entry : {},
  }));

// The profile's slice for one extension, checked against what its manifest declares.
export const checkConfig = (
  id: string,
  configuration: Record<string, unknown>,
  slice: Record<string, unknown>
): CheckedConfig => {
  const all = declarations(configuration);
  const secrets = all.filter((d) => d.declared['secret'] === true).map((d) => d.key);
  const config = Object.fromEntries(Object.entries(slice).filter(([k]) => !secrets.includes(k)));
  for (const { key, declared } of all.filter((d) => !secrets.includes(d.key))) {
    const value = key in slice ? slice[key] : declared['default'];
    const problem = keyProblem(id, key, declared['type'], value);
    if (problem) return { config: {}, secrets: [], problem };
    if (value !== undefined) config[key] = value;
  }
  return { config, secrets, problem: null };
};
