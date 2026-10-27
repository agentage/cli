import chalk from 'chalk';
import { type Command } from 'commander';
import { resolveAuth } from '../../lib/auth/credentials.js';
import { siteFqdn } from '../../lib/net/origins.js';
import { gatherStatus, type StatusReport } from '../../lib/status/status-info.js';
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
  const via = auth.pat ? ' via token' : '';
  if (!auth.signedIn) return `${mark(false)} ${auth.note ?? 'not signed in'}`;
  // Transient: we hold a valid-looking token but could not re-verify - a non-terminal `~`, never ✗.
  if (auth.transient) return `${chalk.yellow('~')} ${auth.note ?? 'signed in'}${via}`;
  return `${mark(true)} signed in${via} (session active)`;
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
  const t = report.target;
  const targetSuffix = t.reachable ? '' : ' - unreachable';
  row('target', `${mark(t.reachable)} ${t.fqdn} (${t.env})${targetSuffix}`);
  row('auth', authLine(report.auth));
  row(
    'endpoint',
    `${mark(report.endpoint.reachable)} ${report.endpoint.url} ` +
      (report.endpoint.reachable ? 'reachable' : 'unreachable')
  );
  if (report.update.message) console.log(chalk.yellow(`\n${report.update.message}`));
};

export interface StatusOptions {
  json?: boolean;
  token?: string;
}

export const runStatus = async (opts: StatusOptions = {}): Promise<void> => {
  const report = await gatherStatus(resolveAuth({ token: opts.token }), siteFqdn());
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printStatus(report);
};

export const registerStatus = (
  program: Command,
  action: (opts: StatusOptions) => Promise<void>
): void => {
  program
    .command('status')
    .description('Show CLI, account, and endpoint status')
    .option('--json', 'machine-readable output')
    .option(
      '--token <token>',
      'authenticate with a personal access token (aga_...); or set AGENTAGE_TOKEN'
    )
    .action(action);
};
