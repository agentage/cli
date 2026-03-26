import { type Command } from 'commander';
import chalk from 'chalk';
import { type Run } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';

interface RunsOpts {
  all?: boolean;
  json?: boolean;
  filter?: string;
  last?: string;
}

export const registerRuns = (program: Command): void => {
  program
    .command('runs')
    .description('List runs')
    .option('--all', 'All runs across all machines')
    .option('--json', 'JSON output')
    .option('--filter <state>', 'Filter by state (working, completed, failed, cancelled)')
    .option('--last <n>', 'Show only last N runs')
    .action(async (opts: RunsOpts) => {
      await ensureDaemon();

      if (opts.all) {
        console.error(chalk.red("Not connected to hub. Run 'agentage login' first."));
        process.exitCode = 1;
        return;
      }

      let runs = await get<Run[]>('/api/runs');

      if (opts.filter) {
        runs = runs.filter((r) => r.state === opts.filter);
      }

      if (opts.last) {
        const n = parseInt(opts.last, 10);
        if (n > 0) {
          runs = runs.slice(-n);
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }

      if (runs.length === 0) {
        console.log(chalk.gray('No runs.'));
        return;
      }

      console.log(
        chalk.bold('ID'.padEnd(12)) +
          chalk.bold('AGENT'.padEnd(16)) +
          chalk.bold('STATE'.padEnd(16)) +
          chalk.bold('STARTED'.padEnd(16)) +
          chalk.bold('DURATION')
      );

      for (const run of runs) {
        const started = run.startedAt ? timeAgo(run.startedAt) : '\u2014';
        const duration =
          run.startedAt && run.endedAt ? formatDuration(run.endedAt - run.startedAt) : '\u2014';
        const stateColor = getStateColor(run.state);

        console.log(
          run.id.slice(0, 8).padEnd(12) +
            run.agentName.padEnd(16) +
            stateColor(run.state).padEnd(16 + (stateColor('').length - ''.length)) +
            started.padEnd(16) +
            duration
        );
      }

      console.log(chalk.dim(`\n${runs.length} runs`));
    });
};

const timeAgo = (ts: number): string => {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const getStateColor = (state: string): ((s: string) => string) => {
  switch (state) {
    case 'completed':
      return chalk.green;
    case 'failed':
      return chalk.red;
    case 'canceled':
      return chalk.yellow;
    case 'working':
      return chalk.blue;
    default:
      return chalk.gray;
  }
};
