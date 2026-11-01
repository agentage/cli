import chalk from 'chalk';
import { type Command } from 'commander';
import { extensionsEnabled } from '../../core/flag.js';
import { resolveAuth } from '../../lib/auth/credentials.js';
import { siteFqdn } from '../../lib/net/origins.js';
import { gatherStatus, type StatusReport } from '../../lib/status/status-info.js';
import { INSTALL_HINT, type UpdateInfo } from '../../lib/update/update-check.js';
import { signedInAccount } from '../extension/account.js';
import { printWarnings, summaryLines } from '../extension/row-lines.js';
import { gatherExtensions, invalidProfileError, type ExtensionsGather } from '../extension/rows.js';
import { gatherWithAccount } from './account-status.js';

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

export interface StatusDeps {
  gather: (opts: StatusOptions) => Promise<StatusReport>;
  // null while the extensions flag is off, so today's output stays byte-identical.
  extensions: (opts: StatusOptions) => Promise<ExtensionsGather | null>;
}

// `account` false: the report that closes setup, which reached the account already.
export const statusDeps = (account = true): StatusDeps => ({
  gather: (opts) => gatherStatus(resolveAuth({ token: opts.token }), siteFqdn()),
  extensions: (opts) => {
    if (!extensionsEnabled()) return Promise.resolve(null);
    return account ? gatherWithAccount(signedInAccount({ token: opts.token })) : gatherExtensions();
  },
});

type ExtensionsOutcome = { gathered: ExtensionsGather | null; error: unknown };

const settle = async (deps: StatusDeps, opts: StatusOptions): Promise<ExtensionsOutcome> => {
  try {
    return { gathered: await deps.extensions(opts), error: null };
  } catch (error) {
    return { gathered: null, error };
  }
};

// With the extensions flag on, `--json` adds machine, profile, the extension count and the plan.
const jsonOf = (report: StatusReport, gathered: ExtensionsGather | null): object => {
  if (!gathered) return report;
  const { machine, profile, extensions, plan } = gathered.status;
  return { ...report, machine, profile, extensions: extensions.length, plan };
};

const emit = (report: StatusReport, gathered: ExtensionsGather | null, json?: boolean): void => {
  if (json) return console.log(JSON.stringify(jsonOf(report, gathered), null, 2));
  printStatus(report);
  for (const text of gathered ? summaryLines(gathered.status) : []) console.log(text);
};

// The report always prints; an extension-side failure then fails the step (exit 1) on stderr.
export const runStatus = async (
  opts: StatusOptions = {},
  deps: StatusDeps = statusDeps()
): Promise<void> => {
  const report = await deps.gather(opts);
  const { gathered, error } = await settle(deps, opts);
  emit(report, gathered, opts.json);
  printWarnings(gathered?.warnings ?? []);
  if (error) throw error;
  const failure = gathered && invalidProfileError(gathered.status.profile);
  if (failure) throw failure;
};

const EXTENSIONS_HELP = `
Extensions: adds this machine's id and name (machine.json), the local profile version
(profile.json) with its source and, for a profile from your account, its etag and the
account's when that moved on, and the number of extensions, with what setup would change, e.g.
(1 to add); agentage extension list shows one row per extension. Signed in, it also marks this
machine seen in your account (--json: machine.registered). Extension code is never loaded; the
only file written is machine.json.`;

export const registerStatus = (
  program: Command,
  action: (opts: StatusOptions) => Promise<void>
): void => {
  const command = program
    .command('status')
    .description(
      extensionsEnabled()
        ? 'Show CLI, account, endpoint, machine, profile, and extension status'
        : 'Show CLI, account, and endpoint status'
    )
    .option('--json', 'machine-readable output')
    .option(
      '--token <token>',
      'authenticate with a personal access token (aga_...); or set AGENTAGE_TOKEN'
    )
    .action(action);
  if (extensionsEnabled()) command.addHelpText('after', EXTENSIONS_HELP);
};
