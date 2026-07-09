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
import { vaultLines } from '../../lib/status/vaults-format.js';
import { INSTALL_HINT, type UpdateInfo } from '../../lib/update/update-check.js';

const mark = (good: boolean): string => (good ? chalk.green('✓') : chalk.red('✗'));

const row = (label: string, value: string): void => {
  console.log(`${label.padEnd(10)} ${value}`);
};

// The signed-in line never shows an absolute expiry: it is the short-lived, auto-refreshed
// access-token expiry, which misreads as "yesterday" near midnight in positive-UTC zones.
// Introspection already proved the session is active server-side.
const authLine = (auth: StatusReport['auth']): string => {
  // Env mismatch: the credential is valid but for another target - neutral `!`, not the expired ✗.
  if (auth.mismatch)
    return `${chalk.yellow('!')} ${auth.note ?? 'signed in to another environment'}`;
  if (!auth.signedIn) return `${mark(false)} ${auth.note ?? 'not signed in'}`;
  // Transient: we hold a valid-looking token but could not re-verify - a non-terminal `~`, never ✗.
  if (auth.transient) return `${chalk.yellow('~')} ${auth.note ?? 'signed in'}`;
  return `${mark(true)} signed in (session active)`;
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

// Daemon rows honor version-mismatch inline (appended to the daemon row) and print mcp only when
// running; the per-vault sync breakdown now lives in its own `vaults` block (printStatus).
const printDaemon = (d: DaemonStatus, cliVersion: string): void => {
  row('daemon', daemonLine(d, cliVersion));
  if (!d.running) return;
  row('mcp', mcpLine(d));
};

export const printStatus = (report: StatusReport): void => {
  row('version', report.version);
  row('update', updateLine(report.update));
  const t = report.target;
  const targetSuffix = t.reachable ? '' : ' - unreachable';
  row('target', `${mark(t.reachable)} ${t.fqdn} (${t.env})${targetSuffix}`);
  row('auth', authLine(report.auth));
  row(
    'endpoint',
    `${mark(report.endpoint.reachable)} ${report.endpoint.url} ` +
      (report.endpoint.reachable ? 'reachable' : 'unreachable')
  );
  if (report.daemon) printDaemon(report.daemon, report.version);
  for (const line of vaultLines(report.vaults)) console.log(line);
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
