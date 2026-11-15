import { type Command } from 'commander';
import { addJson } from '../../lib/json-output.js';
import { type ConfigureOptions } from './configure.js';
import { type InstallOptions, type RemoveOptions } from './lifecycle.js';
import { type ListOptions, type ExtensionUpdateOptions } from './lifecycle-list.js';

type Action<T> = (opts: T) => Promise<void>;

export interface LifecycleActions {
  install: Action<InstallOptions>;
  list: Action<ListOptions>;
  update: Action<ExtensionUpdateOptions>;
  enabled: Action<{ id: string; enabled: boolean; json?: boolean }>;
  configure: Action<ConfigureOptions>;
  remove: Action<RemoveOptions>;
}

const INSTALL_HELP = `
Every lifecycle command is a client of the daemon (agentage daemon status) and starts it when
none runs. <id> asks the market for its newest version; <id>@<version> installs that version,
and over an installed one changes to it, data kept (go back). A local path (./path, ../path,
/path) runs that folder itself, no copy; a folder another user can write is refused. The
extension then runs: its api at 127.0.0.1:4243/api/<id>/ and its commands in agentage --help.`;

const LIST_HELP = `
One row per installed extension: id, version, source (market or folder) and state (starting,
running, failed with the reason, disabled). --json gives the daemon's rows. --available reads
the market instead: each listed id with its newest version.`;

const REMOVE_HELP = `
Stops the extension and forgets its settings and secrets; its data folder (data/<id>/ in the
config folder) stays. --purge also deletes it, after asking; without a terminal it needs --yes.`;

const CONFIGURE_HELP = `
The daemon starts the extension again with the new values, then moves its route: the daemon does
not restart and no request is lost. --secret stores the values as secrets (never printed); a
single <key> with no =value reads the value from stdin, or asks for it on a terminal.`;

const addInstall = (group: Command, { install, list }: LifecycleActions): void => {
  addJson(
    group
      .command('install')
      .description('Install an extension in the daemon and run it')
      .argument('<name>', '<id>, <id>@<version> or a local folder')
      .option('--off', 'old name of: install, then extension disable')
  )
    .addHelpText('after', INSTALL_HELP)
    .action((name: string, opts: Omit<InstallOptions, 'name'>) => install({ name, ...opts }));
  addJson(
    group
      .command('list')
      .description('Show each installed extension: id, version, source, state')
      .option('--available', 'what the market offers, with the newest versions')
  )
    .addHelpText('after', LIST_HELP)
    .action(list);
};

const addChanges = (group: Command, { update, enabled }: LifecycleActions): void => {
  addJson(
    group
      .command('update')
      .description('Move each market extension, or one, to its newest version')
      .argument('[id]', 'only this extension')
      .option('--check', 'only report what would change')
  ).action((id: string | undefined, opts: ExtensionUpdateOptions) => update({ ...opts, id }));
  for (const [name, on] of [
    ['disable', false],
    ['enable', true],
  ] as const)
    addJson(
      group
        .command(name)
        .description(on ? 'Run a disabled extension again' : 'Stop an extension, keep its data')
        .argument('<id>', 'the extension id')
    ).action((id: string, opts: { json?: boolean }) => enabled({ ...opts, id, enabled: on }));
};

const addSettings = (group: Command, { configure, remove }: LifecycleActions): void => {
  addJson(
    group
      .command('configure')
      .description('Set settings (or --secret secrets) of an extension, no restart')
      .argument('<id>', 'the extension id')
      .argument('<pairs...>', '<key>=<value>, one or more')
      .option('--secret', 'store them as secrets')
  )
    .addHelpText('after', CONFIGURE_HELP)
    .action((id: string, pairs: string[], opts: { secret?: boolean; json?: boolean }) =>
      configure({ ...opts, id, pairs })
    );
  addJson(
    group
      .command('remove')
      .description('Stop and remove an extension; its data stays unless --purge')
      .argument('<id>', 'the extension id')
      .option('--purge', "also delete the extension's data, data/<id>/")
      .option('--yes', 'do not ask before --purge deletes (needed without a terminal)')
  )
    .addHelpText('after', REMOVE_HELP)
    .action((name: string, opts: Omit<RemoveOptions, 'name'>) => remove({ name, ...opts }));
};

// C1: install, list, update, disable, enable, configure, remove.
export const addLifecycle = (group: Command, actions: LifecycleActions): void => {
  addInstall(group, actions);
  addChanges(group, actions);
  addSettings(group, actions);
};
