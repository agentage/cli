import { writeFileSync } from 'node:fs';
import { type Profile } from '../../core/profile/schema.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { line } from './line.js';
import {
  accountProfileInstalled,
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

// install: it is not installed; disable: an off entry installed, but its disable failed.
interface Problem {
  kind: 'install' | 'disable';
  text: string;
}
const failed = (text: string): Problem => ({ kind: 'install', text });

const disable = (host: HostClient, id: string) =>
  host.change(id, { enabled: false }).then(
    (row) => ({ row, notDisabled: null }),
    (err: unknown) => ({ row: null, notDisabled: messageOf(err) })
  );

// One entry through POST /host/extensions, as `extension install <id>` sends it; off: then disabled.
const installOne = async (host: HostClient, entry: ProfileEntry & { id: string }) => {
  const added = await host.add(bodyOf(entry.id, entry.range));
  if (!entry.off) return added;
  const { row, notDisabled } = await disable(host, entry.id);
  return row ?? { ...added, notDisabled };
};

// An entry that installed but could not be turned off, or that failed to start.
const problemOf = (id: string, row: Awaited<ReturnType<typeof installOne>>): Problem | null => {
  if ('notDisabled' in row && row.notDisabled)
    return {
      kind: 'disable',
      text: `${id}: ${row.notDisabled}; run agentage extension disable ${id}`,
    };
  return row.state === 'failed' ? failed(`${id}: ${row.error ?? 'failed'}`) : null;
};

const tryOne = async (
  host: HostClient,
  entry: ProfileEntry,
  have: Set<string>
): Promise<Problem | null> => {
  if (entry.id === null) return failed(`${entry.name}: not an @agentage/extension-<id> package`);
  if (have.has(entry.id)) {
    console.log(`${entry.id} already installed`);
    return null;
  }
  const id = entry.id;
  const row = await installOne(host, { ...entry, id }).catch((err: unknown) => ({
    id,
    error: messageOf(err),
  }));
  if ('error' in row && !('state' in row)) return failed(`${id}: ${row.error}`);
  console.log(`${row.id} ${row.version} ${row.state}`);
  return problemOf(id, row);
};

const listed = (title: string, items: string[]) =>
  items.length > 0 ? [`${title}:`, ...items.map((item) => `  ${item}`)] : [];

const problemText = (problems: Problem[]): string => {
  const of = (kind: Problem['kind']) => problems.filter((p) => p.kind === kind).map((p) => p.text);
  const [notInstalled, notDisabled] = [of('install'), of('disable')];
  return [
    ...listed('not installed', notInstalled),
    ...listed('installed but NOT disabled', notDisabled),
  ].join('\n');
};

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
  const have = new Set(host ? (await host.list()).map((row) => row.id) : []);
  const problems: Problem[] = [];
  for (const entry of host ? entries : []) {
    const problem = await tryOne(host as HostClient, entry, have);
    if (problem) problems.push(problem);
  }
  // An empty profile tried nothing: a later setup still installs one with entries.
  if (account && host)
    writeFileSync(profileMarkerPath(), `${new Date().toISOString()}\n`, { mode: 0o600 });
  if (problems.length > 0) throw new CliError('extension_failed', problemText(problems));
};
