import { install, type InstallResult, type InstallSet } from '../../core/installer/installer.js';
import { type Npm } from '../../core/installer/npm.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { missingSecrets } from '../../core/loader/secrets.js';
import { writeHeld } from '../../core/loader/verbs.js';
import { failedError, loadAndGather } from './doctor.js';
import { printWarnings, rowLines } from './row-lines.js';
import { gatherExtensions, type ExtensionsGather } from './rows.js';
import { askSecrets } from './secrets-prompt.js';

export const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

export const counted = (n: number): string =>
  n === 0 ? 'no extensions' : `${n} extension${n === 1 ? '' : 's'}`;

const installLine = (result: InstallResult): string => {
  const how = result.reused ? 'reused' : result.npm ? `npm ${result.npm}` : 'npm skipped';
  return line('install', `${counted(result.count)} in tree ${result.tree} (${how})`);
};

// Asks for, or lists, the secrets the extensions about to load declare and this machine lacks.
export const listSecrets = (extensions: DiscoveredExtension[]): Promise<void> =>
  askSecrets(missingSecrets(extensions));

// Who holds each top-level verb is kept for the next install; one line per namespaced command.
const settleVerbs = ({ verbs }: ExtensionsGather): void => {
  writeHeld(verbs.top);
  for (const { id, name, why } of verbs.namespaced)
    console.log(line('namespaced', `agentage ${id} ${name} (agentage ${name} ${why})`));
};

// Rows print either way, only a good install loads; `installed` runs before anything loads.
export const installAndLoad = async (
  set: InstallSet,
  npm: () => Promise<Npm>,
  installed: () => Promise<unknown> = async () => undefined
): Promise<void> => {
  const outcome = await install(set, npm).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error })
  );
  if (outcome.result) console.log(installLine(outcome.result));
  if (outcome.result) await installed();
  const gathered = outcome.result ? await loadAndGather(listSecrets) : await gatherExtensions();
  for (const text of rowLines(gathered.status.extensions)) console.log(text);
  if (outcome.result) settleVerbs(gathered);
  printWarnings(gathered.warnings);
  if (outcome.error) throw outcome.error;
  const failed = failedError(gathered.status.extensions);
  if (failed) throw failed;
};
