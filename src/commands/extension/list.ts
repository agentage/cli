import chalk from 'chalk';
import { type Command } from 'commander';
import { type ExtensionCheckOptions } from './check.js';
import {
  gatherExtensions,
  invalidProfileError,
  type ExtensionRow,
  type ExtensionsGather,
  type ExtensionsStatus,
  type ProfileStatus,
  type RowState,
} from './rows.js';

const COLOR: Record<RowState, (text: string) => string> = {
  installed: chalk.green,
  ok: chalk.green,
  off: chalk.dim,
  blocked: chalk.yellow,
  invalid: chalk.red,
  failed: chalk.red,
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
  // A failed load quotes the extension's own message; the core's reasons print as they are.
  const reason = row.state === 'failed' ? `"${row.error}"` : row.error;
  const error = row.error === null ? '' : chalk.dim(`  ${reason}`);
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

// The rows, or the whole report as JSON, on stdout; warnings on stderr.
export const printReport = ({ status, warnings }: ExtensionsGather, json?: boolean): void => {
  const rows = status.extensions.length > 0 ? rowLines(status.extensions) : ['no extensions'];
  if (json) console.log(JSON.stringify(status, null, 2));
  else for (const text of rows) console.log(text);
  printWarnings(warnings);
};

// The rows always print; an invalid profile.json then fails the step (exit 1).
export const runExtensionList = async (opts: ExtensionListOptions = {}): Promise<void> => {
  const gathered = await gatherExtensions();
  printReport(gathered, opts.json);
  const failure = invalidProfileError(gathered.status.profile);
  if (failure) throw failure;
};

const LIST_HELP = `
One row per extension in the profile or a dev path: id, state (installed, off, blocked,
invalid, missing), package, installed version, wanted range, contributed commands, the
last run from state/<id>.json, and the reason when it cannot load. Extension code is never
loaded; the only file written is machine.json.`;

const CHECK_HELP = `
Loads every extension this machine can run, once, the way setup does: what an extension prints
while loading goes to stderr, state/<id>.json is rewritten for each, and the rows show ok or
failed with the reason (a dependent of a failed extension is blocked). Exits 1 when any
extension failed.`;

// Bare `extension` prints its help (exit 0); an unknown subcommand stays a usage error (exit 2).
const helpOrUnknown = (_opts: unknown, group: Command): void => {
  const name = group.args[0];
  if (name === undefined) group.help();
  group.error(`error: unknown command '${name}'`, { code: 'commander.unknownCommand' });
};

export const registerExtension = (
  program: Command,
  list: (opts: ExtensionListOptions) => Promise<void>,
  check: (opts: ExtensionCheckOptions) => Promise<void>
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
  group
    .command('check')
    .description('Load every extension once and refresh its state: ok or failed')
    .option('--json', 'machine-readable output')
    .addHelpText('after', CHECK_HELP)
    .action(check);
};
