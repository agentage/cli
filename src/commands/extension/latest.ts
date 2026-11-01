import { type InstallSet } from '../../core/installer/installer.js';
import {
  updateLatest,
  type Held,
  type LatestResult,
  type Staged,
  type VersionChange,
} from '../../core/installer/latest.js';
import { type Npm } from '../../core/installer/npm.js';
import { editableProfile, mutateProfile } from '../../core/profile/profile.js';
import { pushBody, type Apply } from '../../core/profile/push.js';
import { loadAndGather } from './check.js';
import { line, listSecrets } from './install-load.js';
import { printWarnings, rowLines } from './row-lines.js';
import { type ExtensionRow } from './rows.js';
import { localLock, pullForEdit, pushApplied, type EditDeps } from './sync.js';

const changeLine = ({ name, from, to }: VersionChange): string => {
  if (from === null) return `+ add ${name} ${to}`;
  if (to === null) return `- remove ${name} ${from}`;
  return `~ update ${name} ${from} -> ${to}`;
};

const heldLine = ({ name, version, newer, engine }: Held): string =>
  line('kept', `${name} ${version} (${newer} needs extension API ${engine})`);

const printDiff = (result: Omit<LatestResult, 'tree' | 'current'>, tree: string | null): void => {
  for (const held of result.held) console.log(heldLine(held));
  for (const change of result.changes) console.log(changeLine(change));
  const counts = `${result.changes.length} updated, ${result.unchanged} unchanged`;
  console.log(tree === null ? 'latest: nothing to update' : `latest: ${counts} in tree ${tree}`);
};

// Clean: nothing in the new tree failed to load or is invalid.
const notClean = (rows: ExtensionRow[]): Error | null => {
  const bad = rows.filter((row) => row.state === 'failed' || row.state === 'invalid');
  if (bad.length === 0) return null;
  const named = bad.map((row) => `${row.id ?? row.package} ${row.state}`).join(', ');
  return new Error(`not updated: ${named}; extensions/current is unchanged`);
};

// Runs inside the install lock: the diff, then the new tree loaded before it becomes current.
const loadStaged = (outcome: { failure: Error | null }) => async (staged: Staged) => {
  printDiff(staged, staged.tree);
  const gathered = await loadAndGather(listSecrets, staged.dir);
  for (const text of rowLines(gathered.status.extensions)) console.log(text);
  printWarnings(gathered.warnings);
  outcome.failure = notClean(gathered.status.extensions);
  return outcome.failure === null;
};

// One `npm update` of `set`; throws when the new tree did not load clean.
const latestOnce = async (set: InstallSet, npm: () => Promise<Npm>): Promise<LatestResult> => {
  const outcome: { failure: Error | null } = { failure: null };
  const result = await updateLatest(set, npm, loadStaged(outcome));
  if (result.tree === null) printDiff(result, null);
  if (outcome.failure) throw outcome.failure;
  return result;
};

// The account's profile as it is, with the lock of the new tree once it loaded.
const applyLatest =
  (deps: EditDeps): Apply =>
  async (base) => {
    await mutateProfile(() => base.profile);
    const result = await latestOnce({ ...base.profile, lock: base.lock }, deps.npm);
    const kept = { lock: base.lock, npmMajor: base.npmMajor };
    return pushBody(base.profile, base, result.current ? await localLock(deps) : kept);
  };

// `setup --latest`: never signs in; a copy of the account's profile is pushed after a clean load.
export const runSetupLatest = async (deps: EditDeps): Promise<void> => {
  const synced = await pullForEdit(deps);
  if (synced === null) return void (await latestOnce(editableProfile(), deps.npm));
  const done = await pushApplied(synced, applyLatest(deps), { lockCounts: true });
  if (done.pushed) console.log(line('profile', `pushed to your account (etag ${done.etag})`));
};
