import chalk from 'chalk';
import { type Command } from 'commander';
import { readAuth } from '../lib/config.js';
import { siteFqdn } from '../lib/origins.js';
import { gatherStatus, type StatusReport } from '../lib/status-info.js';

const mark = (good: boolean): string => (good ? chalk.green('✓') : chalk.red('✗'));

const row = (label: string, value: string): void => {
  console.log(`${label.padEnd(10)} ${value}`);
};

const authLine = (auth: StatusReport['auth']): string => {
  if (!auth.signedIn) return `${mark(false)} ${auth.note ?? 'not signed in'}`;
  const until = auth.tokenExpiresAt ? ` (token valid until ${auth.tokenExpiresAt})` : '';
  return `${mark(true)} signed in${until}`;
};

export const printStatus = (report: StatusReport): void => {
  row('version', report.version);
  row('target', `${report.fqdn} (${report.env})`);
  row('auth', authLine(report.auth));
  row(
    'endpoint',
    `${mark(report.endpoint.reachable)} ${report.endpoint.url} ` +
      (report.endpoint.reachable ? 'reachable' : 'unreachable')
  );
};

export const runStatus = async (opts: { json?: boolean } = {}): Promise<void> => {
  const report = await gatherStatus(readAuth(), siteFqdn());
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printStatus(report);
};

export const registerStatus = (program: Command): void => {
  program
    .command('status')
    .description('Show CLI, account, and endpoint status')
    .option('--json', 'machine-readable output')
    .action(runStatus);
};
