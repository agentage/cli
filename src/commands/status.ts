import chalk from 'chalk';
import { type Command } from 'commander';
import { readAuth } from '../lib/config.js';
import { siteFqdn } from '../lib/origins.js';
import { gatherStatus, type StatusReport } from '../lib/status-info.js';
import { INSTALL_HINT, type UpdateInfo } from '../lib/update-check.js';

const mark = (good: boolean): string => (good ? chalk.green('✓') : chalk.red('✗'));

const row = (label: string, value: string): void => {
  console.log(`${label.padEnd(10)} ${value}`);
};

const authLine = (auth: StatusReport['auth']): string => {
  if (!auth.signedIn) return `${mark(false)} ${auth.note ?? 'not signed in'}`;
  const until = auth.tokenExpiresAt ? ` (token valid until ${auth.tokenExpiresAt})` : '';
  return `${mark(true)} signed in${until}`;
};

const updateLine = (update: UpdateInfo): string => {
  switch (update.status.kind) {
    case 'current':
      return `${mark(true)} up to date`;
    case 'update-available':
      return chalk.yellow(`↑ ${update.status.latest} available - ${INSTALL_HINT}`);
    case 'unsupported':
      return chalk.red(`${mark(false)} unsupported, update required - ${INSTALL_HINT}`);
    case 'unknown':
      return chalk.dim('- update check unavailable');
  }
};

export const printStatus = (report: StatusReport): void => {
  row('version', report.version);
  row('update', updateLine(report.update));
  row('target', `${report.fqdn} (${report.env})`);
  row('auth', authLine(report.auth));
  row(
    'endpoint',
    `${mark(report.endpoint.reachable)} ${report.endpoint.url} ` +
      (report.endpoint.reachable ? 'reachable' : 'unreachable')
  );
  if (report.update.message) console.log(chalk.yellow(`\n${report.update.message}`));
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
