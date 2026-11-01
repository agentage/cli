import chalk from 'chalk';
import { type Command } from 'commander';
import { type StaticState } from '../../core/loader/states.js';
import {
  gatherExtensions,
  invalidProfileError,
  type ExtensionRow,
  type ExtensionsStatus,
  type ProfileStatus,
} from './rows.js';

const COLOR: Record<StaticState, (text: string) => string> = {
  installed: chalk.green,
  off: chalk.dim,
  blocked: chalk.yellow,
  invalid: chalk.red,
  missing: chalk.yellow,
};

const STATE_WIDTH = Math.max(...Object.keys(COLOR).map((state) => state.length));

const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

const profileText = (profile: ProfileStatus): string => {
  if (profile.state === 'missing') return 'no profile';
  if (profile.state === 'invalid') return chalk.red('invalid');
  const readOnly = profile.readOnly ? chalk.yellow(', read-only') : '';
  return `version ${profile.version} (source: ${profile.source}${readOnly})`;
};

// The three lines `status` adds; the rows themselves belong to `extension list`.
export const summaryLines = (status: ExtensionsStatus): string[] => [
  line('machine', `${status.machine.id} (${status.machine.name})`),
  line('profile', profileText(status.profile)),
  line('extensions', String(status.extensions.length)),
];

const lastRunText = (run: ExtensionRow['lastRun']): string => {
  if (run === null) return '';
  const error = run.error === null ? '' : ` "${run.error}"`;
  return `  last run: ${run.state}${error} at ${run.at}`;
};

const rowLine = (row: ExtensionRow, idWidth: number): string => {
  const id = (row.id ?? '?').padEnd(idWidth);
  const state = COLOR[row.state](row.state.padEnd(STATE_WIDTH));
  const wanted = row.mode === 'dev' ? 'dev' : `wants ${row.wanted ?? '?'}`;
  const pkg = `${row.package} ${row.installed ?? '-'} (${wanted})`;
  const commands = row.commands.length > 0 ? `  commands: ${row.commands.join(', ')}` : '';
  const error = row.error === null ? '' : chalk.dim(`  ${row.error}`);
  return `${id}  ${state}  ${pkg}${commands}${lastRunText(row.lastRun)}${error}`;
};

export const rowLines = (rows: ExtensionRow[]): string[] => {
  const idWidth = Math.max(0, ...rows.map((row) => (row.id ?? '?').length));
  return rows.map((row) => rowLine(row, idWidth));
};

export const printWarnings = (warnings: string[]): void => {
  for (const warning of warnings) console.error(chalk.yellow(`warning: ${warning}`));
};

export interface ExtensionListOptions {
  json?: boolean;
}

// The rows always print; an invalid profile.json then fails the step (exit 1).
export const runExtensionList = async (opts: ExtensionListOptions = {}): Promise<void> => {
  const { status, warnings } = await gatherExtensions();
  const rows = status.extensions.length > 0 ? rowLines(status.extensions) : ['no extensions'];
  if (opts.json) console.log(JSON.stringify(status, null, 2));
  else for (const text of rows) console.log(text);
  printWarnings(warnings);
  const failure = invalidProfileError(status.profile);
  if (failure) throw failure;
};

const LIST_HELP = `
One row per extension in the profile or a dev path: id, state (installed, off, blocked,
invalid, missing), package, installed version, wanted range, contributed commands, the
last run from state/<id>.json, and the reason when it cannot load. Extension code is never
loaded; the only file written is machine.json.`;

// Bare `extension` prints its help (exit 0); an unknown subcommand stays a usage error (exit 2).
const helpOrUnknown = (_opts: unknown, group: Command): void => {
  const name = group.args[0];
  if (name === undefined) group.help();
  group.error(`error: unknown command '${name}'`, { code: 'commander.unknownCommand' });
};

export const registerExtension = (
  program: Command,
  list: (opts: ExtensionListOptions) => Promise<void>
): void => {
  const group = program
    .command('extension')
    .description('Work with the extensions on this machine')
    .allowExcessArguments()
    .action(helpOrUnknown);
  group
    .command('list')
    .description('Show one row per extension: state, versions, commands, last run')
    .option('--json', 'machine-readable output')
    .addHelpText('after', LIST_HELP)
    .action(list);
};
