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

// One entry through POST /host/extensions, as `extension install <id>` sends it; off: then disabled.
const installOne = async (host: HostClient, entry: ProfileEntry & { id: string }) => {
  const added = await host.add(bodyOf(entry.id, entry.range));
  return entry.off ? host.change(entry.id, { enabled: false }) : added;
};

const tryOne = async (host: HostClient, entry: ProfileEntry, have: Set<string>) => {
  if (entry.id === null) return `${entry.name}: not an @agentage/extension-<id> package`;
  if (have.has(entry.id)) {
    console.log(`${entry.id} already installed`);
    return null;
  }
  const id = entry.id;
  const row = await installOne(host, { ...entry, id }).catch((err: unknown) => ({
    id,
    error: messageOf(err),
  }));
  if ('error' in row && !('state' in row)) return `${id}: ${row.error}`;
  console.log(`${row.id} ${row.version} ${row.state}`);
  return row.state === 'failed' ? `${id}: ${row.error ?? 'failed'}` : null;
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
  const problems: string[] = [];
  for (const entry of host ? entries : []) {
    const problem = await tryOne(host as HostClient, entry, have);
    if (problem) problems.push(problem);
  }
  // An empty profile tried nothing: a later setup still installs one with entries.
  if (account && host)
    writeFileSync(profileMarkerPath(), `${new Date().toISOString()}\n`, { mode: 0o600 });
  if (problems.length > 0)
    throw new CliError('extension_failed', `not installed:\n  ${problems.join('\n  ')}`);
};
