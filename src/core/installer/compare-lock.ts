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
const entryKey = (path: string, entry: Doc): string => {
  const name =
    text(entry['name']) || path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
  return `${name}@${text(entry['version'])}+${text(entry['integrity'])}`;
};

// `resolved`, key order and the npm major's layout choices never reach the set.
export const lockEntries = (lock: Doc): string[] => {
  const entries = new Set<string>();
  for (const [path, entry] of Object.entries(packagesOf(lock))) {
    if (path !== '' && isRecord(entry)) entries.add(entryKey(path, entry));
  }
  return [...entries].sort();
};

export const equalLocks = (a: Doc, b: Doc): boolean => {
  const x = lockEntries(a);
  const y = lockEntries(b);
  return x.length === y.length && x.every((entry, i) => entry === y[i]);
};

// npm ci refuses a lock whose root dependencies differ from package.json.
export const lockAgrees = (lock: Doc, dependencies: Record<string, string>): boolean => {
  const root = packagesOf(lock)[''];
  const locked = isRecord(root) && isRecord(root['dependencies']) ? root['dependencies'] : {};
  const names = Object.keys(dependencies);
  return (
    Object.keys(locked).length === names.length &&
    names.every((name) => locked[name] === dependencies[name])
  );
};
