import chalk from 'chalk';
import { type Command } from 'commander';
import { readAuth } from '../../lib/fs/config.js';
import { siteFqdn } from '../../lib/net/origins.js';
import { formatUptime } from '../../lib/status/format.js';
import {
  gatherStatus,
  type DaemonStatus,
  type StatusReport,
} from '../../lib/status/status-info.js';
import { INSTALL_HINT, type UpdateInfo } from '../../lib/update/update-check.js';

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

const daemonLine = (d: DaemonStatus, cliVersion: string): string => {
  if (!d.running) return `${mark(false)} stopped - run: agentage daemon start`;
  const up = d.uptimeSeconds !== undefined ? `, up ${formatUptime(d.uptimeSeconds)}` : '';
  const stale =
    d.daemonVersion && d.daemonVersion !== cliVersion
      ? chalk.yellow(` (version ${d.daemonVersion} != cli ${cliVersion})`)
      : '';
  return `${mark(true)} running (pid ${d.pid ?? '?'}, port ${d.port}${up})${stale}`;
};

const mcpLine = (d: DaemonStatus): string =>
  d.mcp ? `${mark(true)} serving at http://127.0.0.1:${d.port}/mcp` : `${mark(false)} off`;

const syncLine = (sync: NonNullable<DaemonStatus['sync']>): string => {
  if (sync.state === 'syncing') return `${chalk.yellow('⋯')} syncing`;
  if (sync.state === 'error') {
    const short = (sync.lastError ?? 'sync failed').split('\n')[0]?.slice(0, 60);
    return `${mark(false)} error (${short})`;
  }
  const at = sync.lastRun ? ` (last ok ${sync.lastRun})` : '';
  return `${mark(true)} ${sync.vaults} vaults${at}`;
};

// Daemon rows honor version-mismatch inline (appended to the daemon row), mcp only when running,
// and omit the sync row when the daemon is down or serves no vaults.
const printDaemon = (d: DaemonStatus, cliVersion: string): void => {
  row('daemon', daemonLine(d, cliVersion));
  if (!d.running) return;
  row('mcp', mcpLine(d));
  if (d.sync) row('sync', syncLine(d.sync));
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
  if (report.daemon) printDaemon(report.daemon, report.version);
  if (report.update.message) console.log(chalk.yellow(`\n${report.update.message}`));
};

export const runStatus = async (opts: { json?: boolean } = {}): Promise<void> => {
  const report = await gatherStatus(readAuth(), siteFqdn());
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printStatus(report);
};

export const registerStatus = (program: Command): void => {
  program
    .command('status')
    .description('Show CLI, account, and endpoint status')
    .option('--json', 'machine-readable output')
    .action(runStatus);
};
