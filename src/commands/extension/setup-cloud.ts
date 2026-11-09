import chalk from 'chalk';
import {
  localProfile,
  NotPushedError,
  pullProfile,
  type Account,
  type CloudProfile,
} from '../../core/profile/cloud.js';
import {
  forgetAccount,
  loadMachine,
  readMachine,
  setAccount,
  setCloud,
  type MachineFile,
} from '../../core/profile/machine.js';
import { defaultProfile, mutateProfile, readProfile } from '../../core/profile/profile.js';
import { pushWithReplay } from '../../core/profile/push.js';
import { disconnectMachine, registerMachine } from '../../core/profile/register.js';
import { type Profile } from '../../core/profile/schema.js';
import { installAndLoad, line } from './install-load.js';
import { applying, checkAccount, type EditDeps } from './sync.js';

export interface AccountSetupDeps extends EditDeps {
  signOut: () => Promise<void>;
}

const FILE_NOTE = 'from a file (setup --profile), not synced with your account';

// profile.json: null when absent; an invalid one stops setup naming each problem.
const localCopy = (): Profile | null => {
  const parsed = readProfile();
  if (parsed === null) return null;
  if (parsed.ok) return parsed.profile;
  throw new Error(`profile.json is invalid:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`);
};

// The etag profile.json still mirrors: sent as If-None-Match, so an unchanged profile is a 304.
const mirroredEtag = (machine: MachineFile): string | null =>
  machine.profileSource === 'cloud' && readProfile()?.ok === true ? machine.profileEtag : null;

// Without the account: the local profile.json; with none, nothing to install, and setup goes on.
const fromLocalCopy = async (reason: string, deps: EditDeps): Promise<void> => {
  const local = localCopy();
  const unavailable = 'cloud profile unavailable';
  if (local === null)
    return console.error(
      chalk.dim(`${unavailable} and no local profile.json, nothing installed (${reason})`)
    );
  console.error(chalk.dim(`${unavailable}, using local profile.json (${reason})`));
  await installAndLoad(local, deps.npm);
};

const installPulled = async (doc: CloudProfile & { etag: string }, deps: EditDeps) => {
  await mutateProfile(() => doc.profile);
  console.log(line('profile', `pulled from your account (etag ${doc.etag})`));
  await installAndLoad({ ...doc.profile, lock: doc.lock }, deps.npm, () => setCloud(doc.etag));
};

// A create the account did not take fails nothing: the next setup creates it.
const notCreated = (err: unknown): null => {
  if (!(err instanceof NotPushedError)) throw err;
  console.error(chalk.dim(`${err.message}; the next agentage setup tries again`));
  return null;
};

// No profile in the account yet: this machine's own, or the default, becomes it once it loaded.
const createIn = async (account: Account, deps: EditDeps): Promise<void> => {
  const base = localProfile(localCopy() ?? defaultProfile());
  const apply = applying((profile) => profile, deps);
  const done = await pushWithReplay(account.fetch, base, apply).catch(notCreated);
  if (done === null) return;
  await setCloud(done.etag);
  const where = done.pushed ? 'created in' : 'already in';
  console.log(line('profile', `${where} your account (etag ${done.etag})`));
};

// Plain setup pulls and never pushes, except to create the account's first profile.
const profileFrom = async (account: Account, machine: MachineFile, deps: EditDeps) => {
  if (machine.profileSource === 'file') {
    console.log(line('profile', FILE_NOTE));
    return installAndLoad(localCopy() ?? defaultProfile(), deps.npm);
  }
  const pulled = await pullProfile(account.fetch, mirroredEtag(machine));
  if (pulled.kind === 'found') return installPulled(pulled.doc, deps);
  if (pulled.kind === 'none') return createIn(account, deps);
  if (pulled.kind === 'current') return installAndLoad(localCopy() ?? defaultProfile(), deps.npm);
  return fromLocalCopy(pulled.reason, deps);
};

// The first signed-in setup records the account; another account is refused until --disconnect.
const connect = async (account: Account): Promise<MachineFile> => {
  const machine = await loadMachine();
  const userId = await checkAccount(account, machine);
  return userId === null || machine.accountId !== null ? machine : setAccount(userId);
};

// Registration runs alongside the profile, so it never delays setup by more than its 2 s.
export const accountSetup = async (deps: EditDeps): Promise<void> => {
  const account = deps.account();
  if (account === null) return fromLocalCopy('not signed in', deps);
  const platform = await account.platform();
  const machine = await connect(account);
  const registered = registerMachine(account.machines, machine);
  try {
    await profileFrom(account, machine, deps);
  } finally {
    if (await registered) console.log(line('registered', `${machine.id} at ${platform}`));
  }
};

// setup --disconnect: the account marks this machine disconnected, then it forgets the account.
export const disconnect = async (deps: AccountSetupDeps): Promise<void> => {
  const machine = readMachine();
  const account = deps.account();
  if (machine !== null && account !== null) await disconnectMachine(account.machines, machine.id);
  await deps.signOut();
  if (machine !== null) await forgetAccount();
};
