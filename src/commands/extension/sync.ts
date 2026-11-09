import { join } from 'node:path';
import { parseLock } from '../../core/installer/compare-lock.js';
import { type Npm } from '../../core/installer/npm.js';
import { LOCK_FILE, readText } from '../../core/installer/tree.js';
import { extensionsDir } from '../../core/paths.js';
import {
  localProfile,
  NotPushedError,
  pullProfile,
  type Account,
  type CloudFetch,
  type CloudProfile,
} from '../../core/profile/cloud.js';
import { changeProfile } from '../../core/profile/edit.js';
import {
  accountMismatch,
  loadMachine,
  setCloud,
  type MachineFile,
} from '../../core/profile/machine.js';
import { editableProfile, mutateProfile } from '../../core/profile/profile.js';
import {
  pushBody,
  pushWithReplay,
  type Apply,
  type LockPair,
  type Pushed,
  type ReplayOptions,
} from '../../core/profile/push.js';
import { type Profile } from '../../core/profile/schema.js';
import { type AccountOf } from './account.js';
import { installAndLoad, line } from './install-load.js';

// npm, the npm major that writes the lock, and the account: the seams of a profile edit.
export interface EditDeps {
  npm: () => Promise<Npm>;
  npmMajor: () => Promise<number>;
  account: AccountOf;
}

export type Change = (profile: Profile) => Profile;

// Where an edit is pushed, and the account's document it applies to.
export interface Synced {
  fetch: CloudFetch;
  base: CloudProfile;
}

const NOT_SIGNED_IN =
  'not signed in - run: agentage setup (this machine syncs its profile with your account)';
const REPLAY = 'changed in your account meanwhile, replaying this change on it';

// The signed-in account's id, refused when this machine is connected to another account.
export const checkAccount = async (account: Account, machine: MachineFile) => {
  const userId = await account.id();
  const mismatch = accountMismatch(machine, userId);
  if (mismatch) throw mismatch;
  return userId;
};

// Pulled whole, before anything changes, so the edit applies to the account's newest document.
export const pullForEdit = async (deps: EditDeps): Promise<Synced | null> => {
  const machine = await loadMachine();
  if (machine.profileSource !== 'cloud') return null;
  const account = await deps.account();
  if (account === null) throw new Error(NOT_SIGNED_IN);
  await checkAccount(account, machine);
  const pulled = await pullProfile(account.fetch, null);
  if (pulled.kind === 'unavailable')
    throw new Error(`cloud profile unavailable (${pulled.reason}); nothing changed`);
  const base = pulled.kind === 'found' ? pulled.doc : localProfile(editableProfile());
  return { fetch: account.fetch, base };
};

// extensions/package-lock.json and the npm major that wrote it, pushed with the profile.
export const localLock = async (deps: EditDeps): Promise<LockPair> => {
  const lock = parseLock(readText(join(extensionsDir(), LOCK_FILE)));
  return { lock, npmMajor: lock === null ? null : await deps.npmMajor() };
};

// Nothing is pushed unless the new tree installed and loaded: installAndLoad throws otherwise.
export const applying = (change: Change, deps: EditDeps, note: string | null = null): Apply => {
  let calls = 0;
  return async (base) => {
    const next = change(base.profile);
    await mutateProfile(() => next);
    const text = calls++ === 0 ? note : line('profile', REPLAY);
    if (text !== null) console.log(text);
    await installAndLoad({ ...next, lock: base.lock }, deps.npm);
    return pushBody(next, base, await localLock(deps));
  };
};

const onThisMachine = async (change: Change, deps: EditDeps, note: string | null) => {
  await changeProfile(change);
  if (note !== null) console.log(note);
  await installAndLoad(editableProfile(), deps.npm);
};

const installedHere = (err: unknown): never => {
  if (!(err instanceof NotPushedError)) throw err;
  throw new Error(`${err.message}; installed here only, run the command again to push it`);
};

// `apply` installs and loads before it returns the body: a failed load pushes nothing.
export const pushApplied = async (
  synced: Synced,
  apply: Apply,
  opts: ReplayOptions = {}
): Promise<Pushed> => {
  const done = await pushWithReplay(synced.fetch, synced.base, apply, opts).catch(installedHere);
  await setCloud(done.etag);
  return done;
};

// install, remove and --off end here; the account gets the change only after the tree loaded.
export const finishEdit = async (
  synced: Synced | null,
  change: Change,
  deps: EditDeps,
  note: string | null = null
): Promise<void> => {
  if (synced === null) return onThisMachine(change, deps, note);
  const done = await pushApplied(synced, applying(change, deps, note));
  const where = done.pushed ? 'pushed to' : 'already in';
  console.log(line('profile', `${where} your account (etag ${done.etag})`));
};
