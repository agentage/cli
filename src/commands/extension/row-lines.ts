import chalk from 'chalk';
import { pendingChanges, type PlanSummary } from '../../core/installer/plan.js';
import {
  type ExtensionRow,
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

const pendingText = (plan: PlanSummary): string => {
  const changes = pendingChanges(plan);
  return changes.length === 0 ? '' : ` (${changes.join(', ')})`;
};

// The three lines `status` adds; the rows themselves belong to `extension list`.
export const summaryLines = (status: ExtensionsStatus): string[] => [
  line('machine', `${status.machine.id} (${status.machine.name})`),
  line('profile', profileText(status.profile)),
  line('extensions', `${status.extensions.length}${pendingText(status.plan)}`),
];

const lastRunText = (run: ExtensionRow['lastRun']): string => {
  if (run === null) return '';
  const error = run.error === null ? '' : ` "${run.error}"`;
  return `  last run: ${run.state}${error} at ${run.at}`;
};

// What setup would change; blank otherwise, and for off, which the state column already shows.
const driftOf = (row: ExtensionRow): string =>
  row.plan === 'add' || row.plan === 'update' || row.plan === 'remove' ? row.plan : '';

const wantedText = (row: ExtensionRow): string => {
  if (row.mode === 'dev') return 'dev';
  return row.wanted === null ? 'not in profile' : `wants ${row.wanted}`;
};

interface Widths {
  id: number;
  // 0 drops the drift column: nothing to show.
  drift: number;
}

const rowLine = (row: ExtensionRow, widths: Widths): string => {
  const id = (row.id ?? '?').padEnd(widths.id);
  const state = COLOR[row.state](row.state.padEnd(STATE_WIDTH));
  const drift = widths.drift === 0 ? '' : `${driftOf(row).padEnd(widths.drift)}  `;
  const pkg = `${row.package} ${row.installed ?? '-'} (${wantedText(row)})`;
  const commands = row.commands.length > 0 ? `  commands: ${row.commands.join(', ')}` : '';
  // A failed load quotes the extension's own message; the core's reasons print as they are.
  const reason = row.state === 'failed' ? `"${row.error}"` : row.error;
  const error = row.error === null ? '' : chalk.dim(`  ${reason}`);
  return `${id}  ${state}  ${drift}${pkg}${commands}${lastRunText(row.lastRun)}${error}`;
};

export const rowLines = (rows: ExtensionRow[]): string[] => {
  const id = Math.max(0, ...rows.map((row) => (row.id ?? '?').length));
  const drift = Math.max(0, ...rows.map((row) => driftOf(row).length));
  return rows.map((row) => rowLine(row, { id, drift }));
};

export const printWarnings = (warnings: string[]): void => {
  for (const warning of warnings) console.error(chalk.yellow(`warning: ${warning}`));
};
