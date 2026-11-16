import { type Profile } from '../../core/profile/schema.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { line } from './line.js';
import { addOnce } from './install-once.js';
import { NOT_EXTENSION, profileEntries, type ProfileEntry } from './profile-plan.js';
import { readMarker, writeMarker, type FailedEntry } from './setup-marker.js';

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

interface Problem extends FailedEntry {
  text: string;
}

// A problem: no row (install failed) or a failed row; a non-extension package is only said.
const tryOne = async (host: HostClient, entry: ProfileEntry): Promise<Problem | undefined> => {
  if (entry.id === null) return void console.log(`${entry.name}: ${NOT_EXTENSION}`);
  const id = entry.id;
  const row = await installOne(host, { ...entry, id }).catch((err: unknown) => ({
    id,
    error: messageOf(err),
  }));
  if ('error' in row && !('state' in row)) return { id, row: false, text: `${id}: ${row.error}` };
  if ('already' in row && row.state !== 'failed')
    return void console.log(`${id} already installed`);
  if (!('already' in row)) console.log(`${row.id} ${row.version} ${row.state}`);
  const failed = row.state === 'failed';
  return failed ? { id, row: true, text: `${id}: ${row.error ?? 'failed'}` } : undefined;
};

const AGAIN = 'the next setup tries those entries again';

const notInstalled = (problems: Problem[], account: boolean): CliError =>
  new CliError(
    'extension_failed',
    ['not installed:', ...problems.map((p) => `  ${p.text}`), ...(account ? [AGAIN] : [])].join(
      '\n'
    )
  );

// A retry is only the ids that failed; one whose failed row the user removed is not added again.
const retryEntries = async (host: HostClient, entries: ProfileEntry[], failed: FailedEntry[]) => {
  const ids = new Set((await host.list()).map((row) => row.id));
  return entries.filter((entry) => {
    const was = failed.find((f) => f.id === entry.id);
    if (!was) return false;
    if (!was.row || ids.has(was.id)) return true;
    console.log(`${was.id} was removed here; setup does not add it again`);
    return false;
  });
};

const tryAll = async (host: HostClient, entries: ProfileEntry[]): Promise<Problem[]> => {
  const problems: Problem[] = [];
  for (const entry of entries) {
    const problem = await tryOne(host, entry);
    if (problem) problems.push(problem);
  }
  return problems;
};

// Plain setup tries each entry once per machine, then only the ids the marker names as failed.
export const installThroughDaemon = async (
  profile: Profile,
  deps: ProfileInstallDeps
): Promise<void> => {
  const account = deps.from === 'account';
  const failed = account ? readMarker() : null;
  if (failed?.length === 0) return console.log(line('extensions', KEPT));
  const entries = profileEntries(profile);
  if (entries.length > 0 && deps.daemonOff)
    return console.log(line('extensions', 'the daemon is off, nothing installed'));
  if (entries.length === 0) return;
  const host = await deps.host();
  const problems = await tryAll(host, failed ? await retryEntries(host, entries, failed) : entries);
  if (account) writeMarker(problems.map(({ id, row }) => ({ id, row })));
  if (problems.length === 0) return;
  if (!failed) throw notInstalled(problems, account);
  for (const p of problems) console.log(`${p.text} (still fails; the next setup tries it again)`);
};
