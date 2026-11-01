import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { withFileLock } from '../../lib/fs/file-lock.js';
import { isRecord, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { machinePath } from '../paths.js';

export type ProfileSource = 'cloud' | 'file' | 'default';

export interface MachineFile {
  id: string;
  name: string;
  dev: Record<string, string>;
  profileSource: ProfileSource;
  // The account this machine is connected to (the OAuth subject); null until a signed-in setup.
  accountId: string | null;
  // The ETag of the account's profile that profile.json mirrors; null when it mirrors none.
  profileEtag: string | null;
}

// Without machine.json: no dev paths and no `off` list; reading never creates it.
export const NO_MACHINE: MachineFile = {
  id: '',
  name: '',
  dev: {},
  profileSource: 'default',
  accountId: null,
  profileEtag: null,
};

const MACHINE_ID = /^m_[0-9a-f]{8}$/;
const SOURCES: readonly string[] = ['cloud', 'file', 'default'];
const KEYS = Object.keys(NO_MACHINE).length;

const isDevMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((path) => typeof path === 'string');

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value !== '');

// Strict: anything but the exact shape is treated as absent, so no old file is migrated.
const parseMachine = (raw: unknown): MachineFile | null => {
  if (!isRecord(raw) || Object.keys(raw).length !== KEYS) return null;
  const { id, name, dev, profileSource, accountId, profileEtag } = raw;
  if (typeof id !== 'string' || !MACHINE_ID.test(id)) return null;
  if (typeof name !== 'string' || name === '' || !isDevMap(dev)) return null;
  if (typeof profileSource !== 'string' || !SOURCES.includes(profileSource)) return null;
  if (!isTextOrNull(accountId) || !isTextOrNull(profileEtag)) return null;
  const source = profileSource as ProfileSource;
  return { id, name, dev, profileSource: source, accountId, profileEtag };
};

// Read only: null when absent or not exactly the current shape, and nothing is written.
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
  save({ ...NO_MACHINE, id: `m_${randomBytes(4).toString('hex')}`, name: hostname() });

export const loadMachine = async (): Promise<MachineFile> =>
  readMachine() ?? withFileLock(machinePath(), readOrCreate);

// Under the lock; written only when `change` changed something.
const update = async (change: (machine: MachineFile) => MachineFile): Promise<MachineFile> =>
  withFileLock(machinePath(), () => {
    const machine = readOrCreate();
    const next = change(machine);
    return isDeepStrictEqual(next, machine) ? machine : save(next);
  });

export const setProfileSource = async (source: ProfileSource): Promise<MachineFile> =>
  update((machine) => ({ ...machine, profileSource: source }));

// One dev entry by package name: a real path adds or replaces it, null removes it.
export const setDev = async (name: string, path: string | null): Promise<MachineFile> =>
  update((machine) => {
    const dev = Object.fromEntries(Object.entries(machine.dev).filter(([pkg]) => pkg !== name));
    return { ...machine, dev: path === null ? dev : { ...dev, [name]: path } };
  });

// After a pull or a push: profile.json mirrors the account's profile at `etag`.
export const setCloud = async (etag: string): Promise<MachineFile> =>
  update((machine) => ({ ...machine, profileSource: 'cloud', profileEtag: etag }));

export const setAccount = async (accountId: string): Promise<MachineFile> =>
  update((machine) => ({ ...machine, accountId }));

// `setup --disconnect`: no account; a copy of the account's profile becomes this machine's own.
export const forgetAccount = async (): Promise<MachineFile> =>
  update((machine) => ({
    ...machine,
    accountId: null,
    profileEtag: null,
    profileSource: machine.profileSource === 'cloud' ? 'default' : machine.profileSource,
  }));

// A machine stays with the account it was first set up with until `setup --disconnect`.
export const accountMismatch = (machine: MachineFile, userId: string | null): Error | null =>
  machine.accountId === null || userId === null || machine.accountId === userId
    ? null
    : new Error(
        `this machine is connected to account ${machine.accountId}, but you are signed in as ` +
          `${userId}; run agentage setup --disconnect, then agentage setup`
      );
