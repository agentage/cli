import chalk from 'chalk';
import { type StaticState } from '../../core/loader/states.js';
import { type PluginRow, type PluginsStatus, type ProfileStatus } from './status-rows.js';

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
  if (profile.state === 'invalid') return chalk.red('profile.json is invalid');
  const readOnly = profile.readOnly ? chalk.yellow(', read-only') : '';
  return `version ${profile.version} (source: ${profile.source}${readOnly})`;
};

const lastRunText = (run: PluginRow['lastRun']): string => {
  if (run === null) return '';
  const error = run.error === null ? '' : ` "${run.error}"`;
  return `  last run: ${run.state}${error} at ${run.at}`;
};

const pluginLine = (row: PluginRow, idWidth: number): string => {
  const id = (row.id ?? '?').padEnd(idWidth);
  const state = COLOR[row.state](row.state.padEnd(STATE_WIDTH));
  const wanted = row.mode === 'dev' ? 'dev' : `wants ${row.wanted ?? '?'}`;
  const pkg = `${row.package} ${row.installed ?? '-'} (${wanted})`;
  const commands = row.commands.length > 0 ? `  commands: ${row.commands.join(', ')}` : '';
  const error = row.error === null ? '' : chalk.dim(`  ${row.error}`);
  return `  ${id}  ${state}  ${pkg}${commands}${lastRunText(row.lastRun)}${error}`;
};

export const pluginStatusLines = (status: PluginsStatus): string[] => {
  const idWidth = Math.max(0, ...status.plugins.map((row) => (row.id ?? '?').length));
  return [
    line('machine', `${status.machine.id} (${status.machine.name})`),
    line('profile', profileText(status.profile)),
    line('plugins', status.plugins.length === 0 ? 'none' : String(status.plugins.length)),
    ...status.plugins.map((row) => pluginLine(row, idWidth)),
  ];
};
