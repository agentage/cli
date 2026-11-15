import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { unsafeDevPath } from '../../core/loader/dev-path.js';
import { installedExtensions } from '../../core/loader/installed.js';
import { getConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type HostClient, type HostSummary } from '../../lib/daemon/host-client.js';
import { CliError, isJsonRun } from '../../lib/json-output.js';

// Every lifecycle command is a client of the daemon; `host` starts it when none runs.
export interface LifecycleDeps {
  host: () => Promise<HostClient>;
}

// The one seam besides the daemon: a real terminal cannot run inside a test.
export interface ConfirmIo {
  isTTY: boolean;
  prompt: (question: string) => Promise<string>;
}

export interface InstallOptions {
  name: string;
  off?: boolean;
  json?: boolean;
}

export interface RemoveOptions {
  name: string;
  purge?: boolean;
  yes?: boolean;
  force?: boolean;
  json?: boolean;
}

const ID = /^[a-z][a-z0-9-]*$/;
const LOCAL = /^\.{1,2}(?:[/\\]|$)/;
const PACKAGE_PREFIX = /^(@agentage\/extension-|agentage-extension-)/;

// What 0.51 installed and the daemon does not: say what to type instead.
const refusedName = (name: string): string | null => {
  if (/^https?:\/\//i.test(name))
    return `${name}: a tarball URL no longer installs; unpack it, then agentage extension install ./<folder>`;
  if (name.startsWith('@') && !PACKAGE_PREFIX.test(name))
    return `${name}: only @agentage/extension-<id> packages install, by id; for another package, install its folder (./path)`;
  return null;
};

// `probe`, `probe@0.6.2`, or a package name of the id.
export const specOf = (name: string): { id: string; version?: string } => {
  const refused = refusedName(name);
  if (refused) throw new CliError('invalid_argument', refused);
  const at = name.indexOf('@', 1);
  const id = (at < 0 ? name : name.slice(0, at)).replace(PACKAGE_PREFIX, '');
  const version = at < 0 ? undefined : name.slice(at + 1);
  if (!ID.test(id) || version === '')
    throw new CliError('invalid_argument', `${name}: not an id, id@version or a folder (./path)`);
  return { id, ...(version && { version }) };
};

// The real path; a folder another user can write runs code as you, so it is refused.
const folderOf = (input: string): string => {
  let path: string;
  try {
    path = realpathSync(resolve(input));
  } catch {
    throw new CliError('invalid_argument', `${input}: no such folder`);
  }
  const unsafe = unsafeDevPath(path, process.getuid?.());
  if (unsafe) throw new CliError('invalid_argument', unsafe);
  return path;
};

// Installed already: another version is a change of version, so going back keeps the data.
const installSpec = async (host: HostClient, spec: { id: string; version?: string }) => {
  const row = (await host.list()).find((r) => r.id === spec.id);
  if (!row) return host.add(spec);
  if (spec.version && spec.version !== row.version)
    return host.change(spec.id, { version: spec.version });
  return row;
};

export const summaryOf = ({ id, version, state, error }: HostSummary): HostSummary => ({
  id,
  version,
  state,
  ...(error && { error }),
});

// A failed start is listed (state failed) and the command exits 1 with the reason.
export const report = (done: HostSummary): HostSummary => {
  if (done.state === 'failed')
    throw new CliError('extension_failed', `${done.id} failed: ${done.error ?? 'no reason given'}`);
  console.log(`${done.id} ${done.version} ${done.state}`);
  return summaryOf(done);
};

export const runInstall = async (opts: InstallOptions, deps: LifecycleDeps) => {
  const host = await deps.host();
  const folder = LOCAL.test(opts.name) || isAbsolute(opts.name);
  const done = folder
    ? await host.add({ source: folderOf(opts.name) })
    : await installSpec(host, specOf(opts.name));
  if (!opts.off) return report(done);
  console.error('install --off is now: agentage extension disable <id>');
  return report(await host.change(done.id, { enabled: false }));
};

export const runEnabled = async (id: string, enabled: boolean, deps: LifecycleDeps) =>
  report(await (await deps.host()).change(specOf(id).id, { enabled }));

const askLine = async (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

export const terminalIo = (): ConfirmIo => ({
  isTTY: process.stdin.isTTY === true,
  prompt: askLine,
});

// Asked before anything changes; without a terminal (or with --json) only --yes deletes.
const purgeConfirmed = async (id: string, opts: RemoveOptions, io: ConfirmIo) => {
  const data = join(getConfigDir(), 'data', id);
  if (opts.yes) return true;
  if (!io.isTTY || isJsonRun())
    throw new CliError(
      'confirmation_required',
      `--purge without a terminal needs --yes: agentage extension remove ${id} --purge --yes ` +
        `(it deletes ${data})`
    );
  return /^y(es)?$/i.test((await io.prompt(`delete ${data} and everything in it? [y/N] `)).trim());
};

const peersOf = (dir: string): string[] => {
  const peers = readJson(join(dir, 'package.json'), isRecord)?.['peerDependencies'];
  return isRecord(peers) ? Object.keys(peers) : [];
};

// Another installed extension that peer-depends on it would break; --force removes it anyway.
const checkDependents = (id: string, force: boolean | undefined): void => {
  const installed = installedExtensions() ?? [];
  const target = installed.find((ext) => ext.id === id);
  const needing = installed.filter((ext) => target && peersOf(ext.dir).includes(target.pkg));
  if (needing.length === 0 || force) return;
  const names = needing.map((ext) => ext.id ?? ext.pkg).join(', ');
  throw new CliError(
    'needed_by_dependents',
    `${id} is needed by ${names}; remove them first, or --force`
  );
};

export const runRemove = async (opts: RemoveOptions, deps: LifecycleDeps & { io: ConfirmIo }) => {
  const { id } = specOf(opts.name);
  checkDependents(id, opts.force);
  const purge = opts.purge === true && (await purgeConfirmed(id, opts, deps.io));
  if (opts.purge && !purge) throw new CliError('confirmation_required', 'nothing removed');
  await (await deps.host()).remove(id, purge);
  console.log(`removed ${id}${purge ? ', its data deleted' : ''}`);
  return { id, purged: purge };
};
