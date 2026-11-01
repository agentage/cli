import { isRecord } from '../../lib/fs/json-file.js';

type Doc = Record<string, unknown>;

const NODE_MODULES = 'node_modules/';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const parseLock = (raw: string | null): Doc | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && isRecord(value['packages']) ? value : null;
  } catch {
    return null;
  }
};

const packagesOf = (lock: Doc): Doc => (isRecord(lock['packages']) ? lock['packages'] : {});

// Nested and hoisted copies are the same package: only the name after the last node_modules/.
const nameAt = (path: string, entry: Doc): string => {
  const name =
    text(entry['name']) || path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
  return `${name}@${text(entry['version'])}`;
};

const entryKey = (path: string, entry: Doc): string =>
  `${nameAt(path, entry)}+${text(entry['integrity'])}`;

const installed = (lock: Doc): [string, Doc][] =>
  Object.entries(packagesOf(lock)).filter(
    (pair): pair is [string, Doc] => pair[0] !== '' && isRecord(pair[1])
  );

// `resolved`, key order and the npm major's layout choices never reach the set.
export const lockEntries = (lock: Doc): string[] =>
  [...new Set(installed(lock).map(([path, entry]) => entryKey(path, entry)))].sort();

// What package.json asked npm for when it wrote this lock: name -> range or URL.
export const rootDependencies = (lock: Doc): Record<string, string> => {
  const root = packagesOf(lock)[''];
  const deps = isRecord(root) && isRecord(root['dependencies']) ? root['dependencies'] : {};
  return Object.fromEntries(Object.entries(deps).map(([name, spec]) => [name, text(spec)]));
};

// The version the lock installed for a root dependency; null when it has none.
export const lockedVersion = (lock: Doc | null, name: string): string | null => {
  const entry = lock === null ? null : packagesOf(lock)[`${NODE_MODULES}${name}`];
  return isRecord(entry) && typeof entry['version'] === 'string' ? entry['version'] : null;
};

// npm ci refuses a lock whose root dependencies differ from package.json.
export const lockAgrees = (lock: Doc, dependencies: Record<string, string>): boolean => {
  const locked = rootDependencies(lock);
  const names = Object.keys(dependencies);
  return (
    Object.keys(locked).length === names.length &&
    names.every((name) => locked[name] === dependencies[name])
  );
};

const integrities = (lock: Doc): Map<string, string> =>
  new Map(installed(lock).map(([path, entry]) => [nameAt(path, entry), text(entry['integrity'])]));

// The same name@version with another integrity: one of the two locks was changed by hand.
export const integrityDrift = (a: Doc, b: Doc): string[] => {
  const theirs = integrities(b);
  return [...integrities(a)]
    .filter(([key, sri]) => theirs.has(key) && theirs.get(key) !== sri)
    .map(([key]) => key)
    .sort();
};
