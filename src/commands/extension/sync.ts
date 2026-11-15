import { join } from 'node:path';
import { parseLock } from '../../core/installer/compare-lock.js';
import { type Npm } from '../../core/installer/npm.js';
import { LOCK_FILE, readText } from '../../core/installer/tree.js';
import { extensionsDir } from '../../core/paths.js';
import { type Account } from '../../core/profile/cloud.js';
import { accountMismatch, type MachineFile } from '../../core/profile/machine.js';
import { mutateProfile } from '../../core/profile/profile.js';
import { pushBody, type Apply, type LockPair } from '../../core/profile/push.js';
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

const REPLAY = 'changed in your account meanwhile, replaying this change on it';

// The signed-in account's id, refused when this machine is connected to another account.
export const checkAccount = async (account: Account, machine: MachineFile) => {
  const userId = await account.id();
  const mismatch = accountMismatch(machine, userId);
  if (mismatch) throw mismatch;
  return userId;
};

// extensions/package-lock.json and the npm major that wrote it, pushed with the profile.
const localLock = async (deps: EditDeps): Promise<LockPair> => {
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
