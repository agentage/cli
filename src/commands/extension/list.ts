import { type Command } from 'commander';
import { addBuild, type BuildActions } from './build.js';
import { addRelease, type ExtensionReleaseOptions } from './release.js';
import { addCreate, type ExtensionCreateOptions } from './create.js';
import { type ExtensionDoctorOptions } from './doctor.js';
import { addLifecycle, type LifecycleActions } from './lifecycle-commands.js';
import { printWarnings, rowLines } from './row-lines.js';
import { type ExtensionsGather } from './rows.js';
import { addKitTools, type KitActions } from './up.js';

// The rows, or the whole report as JSON, on stdout; warnings on stderr (extension doctor).
export const printReport = ({ status, warnings }: ExtensionsGather, json?: boolean): void => {
  const rows = status.extensions.length > 0 ? rowLines(status.extensions) : ['no extensions'];
  if (json) console.log(JSON.stringify(status, null, 2));
  else for (const text of rows) console.log(text);
  printWarnings(warnings);
};

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

export interface ExtensionActions extends KitActions, BuildActions, LifecycleActions {
  doctor: (opts: ExtensionDoctorOptions) => Promise<void>;
  create: (opts: ExtensionCreateOptions) => Promise<void>;
  release: (opts: ExtensionReleaseOptions) => Promise<void>;
}

const addDoctor = (group: Command, doctor: ExtensionActions['doctor']): void => {
  group
    .command('doctor')
    .description('Load every extension once and refresh its state: ok or failed')
    .option('--json', 'machine-readable output')
    .addHelpText('after', DOCTOR_HELP)
    .action(doctor);
};

// Help order: C1 (install to remove), then doctor, create, check, build, release, up, down, token.
export const registerExtension = (program: Command, actions: ExtensionActions): void => {
  const group = program
    .command('extension')
    .description('Work with the extensions on this machine')
    .allowExcessArguments()
    .action(helpOrUnknown);
  addLifecycle(group, actions);
  addDoctor(group, actions.doctor);
  addCreate(group, actions.create);
  addBuild(group, actions);
  addRelease(group, actions.release);
  addKitTools(group, actions);
};
