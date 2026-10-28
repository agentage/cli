import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { withFileLock } from '../../lib/fs/file-lock.js';
import { isRecord, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { machinePath } from '../paths.js';

export type ProfileSource = 'cloud' | 'file' | 'default';

export interface MachineFile {
  id: string;
  name: string;
  dev: Record<string, string>;
  profileSource: ProfileSource;
}

export interface MachineDeps {
  path: () => string;
  read: (path: string) => unknown;
  write: (path: string, machine: MachineFile) => void;
  lock: <T>(path: string, fn: () => T) => Promise<T>;
  hostname: () => string;
  newId: () => string;
}

const SOURCES: readonly string[] = ['cloud', 'file', 'default'];

const readRaw = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

const defaultDeps: MachineDeps = {
  path: machinePath,
  read: readRaw,
  write: (path, machine) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeJsonAtomic(path, machine);
  },
  lock: (path, fn) => withFileLock(path, fn),
  hostname: () => hostname(),
  newId: () => `m_${randomBytes(4).toString('hex')}`,
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const devOf = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string')
      )
    : {};

const sourceOf = (value: unknown): ProfileSource =>
  typeof value === 'string' && SOURCES.includes(value) ? (value as ProfileSource) : 'default';

// Keeps an existing id (a legacy uuid included) and any keys a newer CLI added.
export const normalizeMachine = (raw: unknown, deps: MachineDeps): MachineFile => {
  const rec = isRecord(raw) ? raw : {};
  return {
    ...rec,
    id: nonEmpty(rec['id']) ?? deps.newId(),
    name: nonEmpty(rec['name']) ?? deps.hostname(),
    dev: devOf(rec['dev']),
    profileSource: sourceOf(rec['profileSource']),
  };
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Re-read under the lock so two first runs agree on one id.
const repair = (deps: MachineDeps, path: string): MachineFile => {
  const fresh = deps.read(path);
  const machine = normalizeMachine(fresh, deps);
  if (!same(fresh, machine)) deps.write(path, machine);
  return machine;
};

export const loadMachine = async (deps: MachineDeps = defaultDeps): Promise<MachineFile> => {
  const path = deps.path();
  const current = deps.read(path);
  const machine = normalizeMachine(current, deps);
  if (same(current, machine)) return machine;
  return deps.lock(path, () => repair(deps, path));
};
