import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installationPath } from '../../core/loader/installed.js';
import { type Profile } from '../../core/profile/schema.js';
import { type HostClient } from '../../lib/daemon/host-client.js';
import { getConfigDir } from '../../lib/fs/config.js';
import { CliError, messageOf } from '../../lib/json-output.js';
import { line } from './line.js';

const PACKAGE_ID = /^(?:@agentage\/extension-|agentage-extension-)([a-z][a-z0-9-]*)$/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface ProfileInstallDeps {
  // The daemon, started when none runs.
  host: () => Promise<HostClient>;
  // --no-daemon or AGENTAGE_NO_DAEMON=1: nothing starts, so nothing installs.
  daemonOff: boolean;
}

// Written before the first entry, removed once every entry was tried: the next setup goes on.
export const setupMarkerPath = (): string => join(getConfigDir(), 'setup.installing');

const KEPT =
  'installation.json holds this machine; setup installs nothing (agentage extension install)';

// The first install on this machine, or one a stop left unfinished.
const firstInstall = (): boolean =>
  !existsSync(installationPath()) || existsSync(setupMarkerPath());

// An exact version is sent as it is; a range installs the market's newest version.
const bodyOf = (id: string, range: string): { id: string; version?: string } =>
  EXACT.test(range) ? { id, version: range } : { id };

// One profile entry through POST /host/extensions, as `extension install <id>` sends it.
const installOne = async (host: HostClient, name: string, range: string) => {
  const id = PACKAGE_ID.exec(name)?.[1];
  if (!id) return `${name}: not an @agentage/extension-<id> package, not installed`;
  const row = await host
    .add(bodyOf(id, range))
    .catch((err: unknown) => ({ id, error: messageOf(err) }));
  if ('error' in row) return `${id}: ${row.error}`;
  console.log(`${row.id} ${row.version} ${row.state}`);
  return row.state === 'failed' ? `${id}: ${row.error ?? 'failed'}` : null;
};

const installAll = async (host: HostClient, entries: [string, string][]): Promise<string[]> => {
  const have = new Set((await host.list()).map((row) => row.id));
  const problems: string[] = [];
  for (const [name, range] of entries) {
    if (have.has(PACKAGE_ID.exec(name)?.[1] ?? '')) continue;
    const problem = await installOne(host, name, range);
    if (problem) problems.push(problem);
  }
  return problems;
};

// The profile's extensions go through the daemon, which runs them; the cli loads nothing itself.
// Only a first install: later setups leave installation.json alone.
export const installThroughDaemon = async (
  profile: Profile,
  deps: ProfileInstallDeps
): Promise<void> => {
  if (!firstInstall()) return console.log(line('extensions', KEPT));
  const entries = Object.entries(profile.extensions);
  if (entries.length === 0) return;
  writeFileSync(setupMarkerPath(), '', { mode: 0o600 });
  if (deps.daemonOff)
    return console.log(line('extensions', 'the daemon is off, nothing installed'));
  const problems = await installAll(await deps.host(), entries);
  rmSync(setupMarkerPath(), { force: true });
  if (problems.length > 0)
    throw new CliError('extension_failed', `not installed:\n  ${problems.join('\n  ')}`);
};
