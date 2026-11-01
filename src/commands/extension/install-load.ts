import { install, type InstallResult, type InstallSet } from '../../core/installer/installer.js';
import { type Npm } from '../../core/installer/npm.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { missingSecrets } from '../../core/loader/secrets.js';
import { failedError, loadAndGather } from './check.js';
import { printWarnings, rowLines } from './row-lines.js';
import { gatherExtensions } from './rows.js';
import { askSecrets } from './secrets-prompt.js';

export const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

export const counted = (n: number): string =>
  n === 0 ? 'no extensions' : `${n} extension${n === 1 ? '' : 's'}`;

const installLine = (result: InstallResult): string => {
  const how = result.reused ? 'reused' : result.npm ? `npm ${result.npm}` : 'npm skipped';
  return line('install', `${counted(result.count)} in tree ${result.tree} (${how})`);
};

const listSecrets = (extensions: DiscoveredExtension[]): Promise<void> =>
  askSecrets(missingSecrets(extensions));

// setup, install and remove end here: rows print either way, only a good install loads.
export const installAndLoad = async (set: InstallSet, npm: () => Promise<Npm>): Promise<void> => {
  const outcome = await install(set, npm).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error })
  );
  if (outcome.result) console.log(installLine(outcome.result));
  const gathered = outcome.result ? await loadAndGather(listSecrets) : await gatherExtensions();
  for (const text of rowLines(gathered.status.extensions)) console.log(text);
  printWarnings(gathered.warnings);
  if (outcome.error) throw outcome.error;
  const failed = failedError(gathered.status.extensions);
  if (failed) throw failed;
};
