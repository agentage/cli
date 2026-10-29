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

export const MACHINE_ID = /^m_[0-9a-f]{8}$/;
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

const isDevMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((path) => typeof path === 'string');

// Strict: anything but the exact v1 shape is treated as absent, so no old file is migrated.
export const parseMachine = (raw: unknown): MachineFile | null => {
  if (!isRecord(raw) || Object.keys(raw).length !== 4) return null;
  const { id, name, dev, profileSource } = raw;
  if (typeof id !== 'string' || !MACHINE_ID.test(id)) return null;
  if (typeof name !== 'string' || name === '') return null;
  if (!isDevMap(dev) || typeof profileSource !== 'string' || !SOURCES.includes(profileSource))
    return null;
  return { id, name, dev, profileSource: profileSource as ProfileSource };
};

// Re-read under the lock so two first runs agree on one id.
const create = (deps: MachineDeps, path: string): MachineFile => {
  const fresh = parseMachine(deps.read(path));
  if (fresh) return fresh;
  const machine: MachineFile = {
    id: deps.newId(),
    name: deps.hostname(),
    dev: {},
    profileSource: 'default',
  };
  deps.write(path, machine);
  return machine;
};

export const loadMachine = async (deps: MachineDeps = defaultDeps): Promise<MachineFile> => {
  const path = deps.path();
  return parseMachine(deps.read(path)) ?? deps.lock(path, () => create(deps, path));
};
