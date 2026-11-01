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

// Without machine.json: no dev paths and no `off` list; reading never creates it.
export const NO_MACHINE: MachineFile = { id: '', name: '', dev: {}, profileSource: 'default' };

const MACHINE_ID = /^m_[0-9a-f]{8}$/;
const SOURCES: readonly string[] = ['cloud', 'file', 'default'];

const isDevMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((path) => typeof path === 'string');

// Strict: anything but the exact v1 shape is treated as absent, so no old file is migrated.
const parseMachine = (raw: unknown): MachineFile | null => {
  if (!isRecord(raw) || Object.keys(raw).length !== 4) return null;
  const { id, name, dev, profileSource } = raw;
  if (typeof id !== 'string' || !MACHINE_ID.test(id)) return null;
  if (typeof name !== 'string' || name === '') return null;
  if (!isDevMap(dev) || typeof profileSource !== 'string' || !SOURCES.includes(profileSource))
    return null;
  return { id, name, dev, profileSource: profileSource as ProfileSource };
};

// Read only: null when absent or not exactly v1, and nothing is written.
export const readMachine = (): MachineFile | null => {
  try {
    return parseMachine(JSON.parse(readFileSync(machinePath(), 'utf-8')));
  } catch {
    return null;
  }
};

const save = (machine: MachineFile): MachineFile => {
  mkdirSync(dirname(machinePath()), { recursive: true, mode: 0o700 });
  writeJsonAtomic(machinePath(), machine);
  return machine;
};

// Re-read under the lock so two first runs agree on one id.
const readOrCreate = (): MachineFile =>
  readMachine() ??
  save({
    id: `m_${randomBytes(4).toString('hex')}`,
    name: hostname(),
    dev: {},
    profileSource: 'default',
  });

export const loadMachine = async (): Promise<MachineFile> =>
  readMachine() ?? withFileLock(machinePath(), readOrCreate);

export const setProfileSource = async (source: ProfileSource): Promise<MachineFile> =>
  withFileLock(machinePath(), () => {
    const machine = readOrCreate();
    return machine.profileSource === source ? machine : save({ ...machine, profileSource: source });
  });

// One dev entry by package name: a real path adds or replaces it, null removes it.
export const setDev = async (name: string, path: string | null): Promise<MachineFile> =>
  withFileLock(machinePath(), () => {
    const machine = readOrCreate();
    const dev = Object.fromEntries(Object.entries(machine.dev).filter(([pkg]) => pkg !== name));
    return save({ ...machine, dev: path === null ? dev : { ...dev, [name]: path } });
  });
