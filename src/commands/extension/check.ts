import { driftLines } from '../../core/installer/plan.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { loadExtensions } from '../../core/loader/load.js';
import { loadSet, scan } from '../../core/loader/scan.js';
import { loadMachine } from '../../core/profile/machine.js';
import { printReport } from './list.js';
import {
  gatherFrom,
  invalidProfileError,
  type ExtensionRow,
  type ExtensionsGather,
} from './rows.js';

export interface ExtensionCheckOptions {
  json?: boolean;
}

type BeforeLoad = (extensions: DiscoveredExtension[]) => Promise<void>;

// Loads what can load, once: state files rewritten, rows carrying this run's ok and failed.
export const loadAndGather = async (
  beforeLoad: BeforeLoad = async () => undefined
): Promise<ExtensionsGather> => {
  const found = scan(await loadMachine());
  const extensions = loadSet(found);
  await beforeLoad(extensions);
  const session = await loadExtensions(extensions);
  await session.dispose();
  return gatherFrom(found, session.outcomes);
};

export const failedError = (rows: ExtensionRow[]): Error | null => {
  const failed = rows.filter((row) => row.state === 'failed').map((row) => row.id ?? row.package);
  if (failed.length === 0) return null;
  const count = `${failed.length} extension${failed.length === 1 ? '' : 's'}`;
  return new Error(`${count} failed to load: ${failed.join(', ')}`);
};

// Integrity drift: the extensions it names were not loaded, and setup refuses to build on it.
const driftError = (drift: string[]): Error | null =>
  drift.length === 0 ? null : new Error(driftLines(drift).join('\n'));

// The rows always print; an invalid profile.json, integrity drift or a failed load fails the step.
export const runExtensionCheck = async (opts: ExtensionCheckOptions = {}): Promise<void> => {
  const gathered = await loadAndGather();
  printReport(gathered, opts.json);
  const { profile, extensions } = gathered.status;
  const failure =
    invalidProfileError(profile) ?? driftError(gathered.drift) ?? failedError(extensions);
  if (failure) throw failure;
};
