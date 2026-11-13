import { type Command } from 'commander';
import { addBuild, type BuildActions } from './build.js';
import { addRelease, type ExtensionReleaseOptions } from './release.js';
import { addCreate, type ExtensionCreateOptions } from './create.js';
import { type ExtensionDoctorOptions } from './doctor.js';
import { type ExtensionInstallOptions } from './install.js';
import { type ExtensionRemoveOptions } from './remove.js';
import { printWarnings, rowLines, type Latest } from './row-lines.js';
import { type Market } from '../../lib/net/market.js';
import { gatherExtensions, invalidProfileError, type ExtensionsGather } from './rows.js';
import { addKitTools, type KitActions } from './up.js';

export interface ExtensionListOptions {
  json?: boolean;
}

const withLatest = (status: ExtensionsGather['status'], latest: Latest) => ({
  ...status,
  extensions: status.extensions.map((row) => ({
    ...row,
    latest: latest.get(row.id ?? '') ?? null,
  })),
});

// The rows, or the whole report as JSON, on stdout; warnings on stderr.
export const printReport = (
  { status, warnings }: ExtensionsGather,
  json?: boolean,
  latest?: Latest
): void => {
  const rows =
    status.extensions.length > 0 ? rowLines(status.extensions, latest) : ['no extensions'];
  if (json) console.log(JSON.stringify(latest ? withLatest(status, latest) : status, null, 2));
  else for (const text of rows) console.log(text);
  printWarnings(warnings);
};

// A refused answer costs only its own row: one stderr line, no version.
const versionOf = async (market: Market, id: string): Promise<string | null> => {
  try {
    return (await market.latest(id))?.version ?? null;
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
};

// The market's newest version for each installed id it knows; unknown or refused ids are null.
const newest = async (
  { status }: ExtensionsGather,
  market: Market
): Promise<Latest | undefined> => {
  const ids = status.extensions.flatMap((row) => (row.id === null ? [] : [row.id]));
  const found = await Promise.all(
    ids.map(async (id) => [id, await versionOf(market, id)] as const)
  );
  return market.down() ? undefined : new Map(found);
};

// The rows always print; an invalid profile.json then fails the step (exit 1).
export const runExtensionList = async (
  opts: ExtensionListOptions = {},
  market?: Market
): Promise<void> => {
  const gathered = await gatherExtensions();
  printReport(gathered, opts.json, market && (await newest(gathered, market)));
  const failure = invalidProfileError(gathered.status.profile);
  if (failure) throw failure;
};

const INSTALL_HELP = `
<name> is resolved in this order: a local path (./path or /path) is a working copy, linked as a
dev extension: kept in machine.json by its real path and loaded on this machine only, in place
of an installed copy of the same package; http:, file:, npm: and github: are refused; an https:
tarball URL and a package name are used as written (a name without @<range> is pinned to ^ its
newest version whose engines.agentage fits this CLI's extension API, or the kit's version for a
package built on the extension kit, naming each newer version it skipped); a bare id like memory
asks the market first and takes its latest version (a private entry has no npm package and is
refused), else it is @agentage/extension-memory, then agentage-extension-memory. A package goes into
profile.json (created from the default profile when absent), from the registry the profile
names for its scope; --off keeps it from loading on this machine. Then installs and loads like
setup, and exits 1 when an extension failed. Never signs in. On a machine whose profile comes
from your account, the change applies to the account's newest profile and is pushed (with npm's
lock) once everything loaded; if another machine pushed in between, it is replayed once on that
profile. The commands of a package built on the kit run as agentage <command> and always as
agentage <id> <command>; one whose name is a core command, an extension id or a command an
earlier install took runs only as agentage <id> <command>, and one line says so.`;

const REMOVE_HELP = `
<name> is a package name, a short name or an extension id. Refused while another extension
peer-depends on it. Takes it out of profile.json and this machine's off list, or out of
machine.json for a dev extension, deletes state/<id>.json, then installs and loads the rest like
setup, and pushes the profile to your account like install. --purge also deletes data/<id>/
after asking; without a terminal it needs --yes.`;

const LIST_HELP = `
One row per extension in the profile, a dev path or the installed tree: id, state (installed,
off, blocked, invalid, missing), what setup would change (add, update, remove; blank for
nothing), package, installed version, wanted range, contributed commands, the last run from
state/<id>.json, and the reason when it cannot load. Extension code is never loaded; the only
file written is machine.json.`;

const DOCTOR_HELP = `
Loads every extension this machine can run, once, the way setup does: what an extension prints
while loading goes to stderr, state/<id>.json is rewritten for each, and the rows show ok or
failed with the reason (a dependent of a failed extension is blocked). An extension built on the
extension kit is ok when its command entry exports create and its handlers are the commands it
declares. Exits 1 when any extension failed, or on integrity drift between the lock and the
installed tree.`;

// Bare `extension` prints its help (exit 0); an unknown subcommand stays a usage error (exit 2).
export const helpOrUnknown = (_opts: unknown, group: Command): void => {
  const name = group.args[0];
  if (name === undefined) group.help();
  group.error(`error: unknown command '${name}'`, { code: 'commander.unknownCommand' });
};

export interface ExtensionActions extends KitActions, BuildActions {
  install: (opts: ExtensionInstallOptions) => Promise<void>;
  remove: (opts: ExtensionRemoveOptions) => Promise<void>;
  list: (opts: ExtensionListOptions) => Promise<void>;
  doctor: (opts: ExtensionDoctorOptions) => Promise<void>;
  create: (opts: ExtensionCreateOptions) => Promise<void>;
  release: (opts: ExtensionReleaseOptions) => Promise<void>;
}

const addChanges = (group: Command, { install, remove }: ExtensionActions): void => {
  group
    .command('install')
    .description('Add an extension to the profile, then install and load it')
    .argument('<name>', 'package name[@range], short name, https: tarball URL or local path')
    .option('--off', 'install it, but do not load it on this machine')
    .addHelpText('after', INSTALL_HELP)
    .action((name: string, opts: { off?: boolean }) => install({ name, ...opts }));
  group
    .command('remove')
    .description('Remove an extension from the profile, then install and load the rest')
    .argument('<name>', 'package name, short name or extension id')
    .option('--purge', "also delete the extension's data, data/<id>/")
    .option('--yes', 'do not ask before --purge deletes (needed without a terminal)')
    .addHelpText('after', REMOVE_HELP)
    .action((name: string, opts: { purge?: boolean; yes?: boolean }) => remove({ name, ...opts }));
};

const addReports = (group: Command, { list, doctor }: ExtensionActions): void => {
  group
    .command('list')
    .description('Show one row per extension: state, versions, commands, last run')
    .option('--json', 'machine-readable output')
    .addHelpText('after', LIST_HELP)
    .action(list);
  group
    .command('doctor')
    .description('Load every extension once and refresh its state: ok or failed')
    .option('--json', 'machine-readable output')
    .addHelpText('after', DOCTOR_HELP)
    .action(doctor);
};

// Help lists the subcommands in this order: install, remove, list, doctor, create, check, build, release, up, down, token.
export const registerExtension = (program: Command, actions: ExtensionActions): void => {
  const group = program
    .command('extension')
    .description('Work with the extensions on this machine')
    .allowExcessArguments()
    .action(helpOrUnknown);
  addChanges(group, actions);
  addReports(group, actions);
  addCreate(group, actions.create);
  addBuild(group, actions);
  addRelease(group, actions.release);
  addKitTools(group, actions);
};
