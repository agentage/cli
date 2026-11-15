import { existsSync } from 'node:fs';
import { installationPath } from '../../core/loader/installed.js';
import { type Profile } from '../../core/profile/schema.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { line } from './install-load.js';

const PACKAGE_ID = /^(?:@agentage\/extension-|agentage-extension-)([a-z][a-z0-9-]*)$/;

export interface ProfileInstallDeps {
  // The daemon, started when none runs.
  host: () => Promise<HostClient>;
  // --no-daemon or AGENTAGE_NO_DAEMON=1: nothing starts, so nothing installs.
  daemonOff: boolean;
}

const KEPT =
  'installation.json holds this machine; setup installs nothing (agentage extension install)';

// One profile entry through POST /host/extensions, as `extension install <id>` sends it.
const installOne = async (host: HostClient, name: string): Promise<string | null> => {
  const id = PACKAGE_ID.exec(name)?.[1];
  if (!id) return `${name}: not an @agentage/extension-<id> package, not installed`;
  const row = await host.add({ id }).catch((err: unknown) => ({ id, error: messageOf(err) }));
  if ('error' in row) return `${id}: ${row.error}`;
  console.log(`${row.id} ${row.version} ${row.state}`);
  return row.state === 'failed' ? `${id}: ${row.error ?? 'failed'}` : null;
};

// Plain setup on a machine with no installation.json yet: the profile's extensions go through
// the daemon, which runs them; the cli loads nothing itself. Later setups leave the list alone.
export const installThroughDaemon = async (
  profile: Profile,
  deps: ProfileInstallDeps
): Promise<void> => {
  if (existsSync(installationPath())) return console.log(line('extensions', KEPT));
  const names = Object.keys(profile.extensions);
  if (names.length === 0) return;
  if (deps.daemonOff)
    return console.log(line('extensions', 'the daemon is off, nothing installed'));
  const host = await deps.host();
  const have = new Set((await host.list()).map((row) => row.id));
  const problems: string[] = [];
  for (const name of names) {
    if (have.has(PACKAGE_ID.exec(name)?.[1] ?? '')) continue;
    const problem = await installOne(host, name);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0)
    throw new CliError('extension_failed', `not installed:\n  ${problems.join('\n  ')}`);
};
