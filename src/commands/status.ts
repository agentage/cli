import chalk from 'chalk';
import { type Command } from 'commander';
import { isDaemonRunning, resolvePort } from '../daemon/lifecycle.js';
import { readAuth } from '../lib/config.js';
import { health, mismatchNotice } from '../lib/daemon-client.js';
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

// Warn only about a daemon this config dir owns (a live pidfile) so `status` never probes an
// unrelated daemon; the hint tells the user to restart it after a CLI upgrade.
const warnDaemonMismatch = async (): Promise<void> => {
  if (!isDaemonRunning()) return;
  const h = await health(resolvePort());
  if (!h) return;
  const notice = mismatchNotice(h.version);
  if (notice) console.error(chalk.yellow(notice)); // diagnostics go to stderr
};

export const runStatus = async (opts: { json?: boolean } = {}): Promise<void> => {
  const report = await gatherStatus(readAuth(), siteFqdn());
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printStatus(report);
  await warnDaemonMismatch();
};

export const registerStatus = (program: Command): void => {
  program
    .command('status')
    .description('Show CLI, account, and endpoint status')
    .option('--json', 'machine-readable output')
    .action(runStatus);
};
