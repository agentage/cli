import { writeFileSync } from 'node:fs';
import { type Profile } from '../../core/profile/schema.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { line } from './line.js';
import { addOnce } from './install-once.js';
import {
  accountProfileInstalled,
  NOT_EXTENSION,
  profileEntries,
  profileMarkerPath,
  type ProfileEntry,
} from './profile-plan.js';

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface ProfileInstallDeps {
  // The daemon, started when none runs.
  host: () => Promise<HostClient>;
  // --no-daemon or AGENTAGE_NO_DAEMON=1: nothing starts, so nothing installs.
  daemonOff: boolean;
  // account: plain setup, once per machine; file: `setup --profile`, an explicit ask, never gated.
  from: 'account' | 'file';
}

const KEPT =
  'your account profile was installed here already; setup installs nothing (agentage extension install)';

// An exact version is sent as it is; a range installs the market's newest version.
const bodyOf = (id: string, range: string): { id: string; version?: string } =>
  EXACT.test(range) ? { id, version: range } : { id };

type Entry = ProfileEntry & { id: string };

// One entry through POST /host/extensions; an off entry is added disabled (it never starts).
const installOne = async (host: HostClient, entry: Entry) => {
  const off = entry.off ? { enabled: false as const } : {};
  const { row, already } = await addOnce(host, { ...bodyOf(entry.id, entry.range), ...off });
  return already ? { ...row, already } : row;
};

// A package that is not an extension is said and skipped: the daemon cannot install it, ever.
// A problem is the line under "not installed": the entry failed to install or to start.
const tryOne = async (host: HostClient, entry: ProfileEntry): Promise<string | undefined> => {
  if (entry.id === null) return void console.log(`${entry.name}: ${NOT_EXTENSION}`);
  const id = entry.id;
  const row = await installOne(host, { ...entry, id }).catch((err: unknown) => ({
    id,
    error: messageOf(err),
  }));
  if ('error' in row && !('state' in row)) return `${id}: ${row.error}`;
  if ('already' in row) return void console.log(`${id} already installed`);
  console.log(`${row.id} ${row.version} ${row.state}`);
  return row.state === 'failed' ? `${id}: ${row.error ?? 'failed'}` : undefined;
};

const AGAIN = 'the next setup tries the profile again';

const notInstalled = (problems: string[], account: boolean): CliError =>
  new CliError(
    'extension_failed',
    ['not installed:', ...problems.map((p) => `  ${p}`), ...(account ? [AGAIN] : [])].join('\n')
  );

// The profile's extensions go through the daemon, which runs them; the cli loads nothing itself.
// An entry already in the installation is left as it is.
export const installThroughDaemon = async (
  profile: Profile,
  deps: ProfileInstallDeps
): Promise<void> => {
  const account = deps.from === 'account';
  if (account && accountProfileInstalled()) return console.log(line('extensions', KEPT));
  const entries = profileEntries(profile);
  if (entries.length > 0 && deps.daemonOff)
    return console.log(line('extensions', 'the daemon is off, nothing installed'));
  const host = entries.length > 0 ? await deps.host() : null;
  const problems: string[] = [];
  for (const entry of host ? entries : []) {
    const problem = await tryOne(host as HostClient, entry);
    if (problem) problems.push(problem);
  }
  // An empty profile tried nothing, a refused or failed entry is tried again: no marker for either.
  if (problems.length > 0) throw notInstalled(problems, account);
  if (account && host)
    writeFileSync(profileMarkerPath(), `${new Date().toISOString()}\n`, { mode: 0o600 });
};
