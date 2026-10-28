import chalk from 'chalk';
import { type Command } from 'commander';
import { pluginsEnabled } from '../../core/flag.js';
import { resolveAuth } from '../../lib/auth/credentials.js';
import { siteFqdn } from '../../lib/net/origins.js';
import { gatherStatus, type StatusReport } from '../../lib/status/status-info.js';
import { INSTALL_HINT, type UpdateInfo } from '../../lib/update/update-check.js';
import { pluginStatusLines } from '../plugins/status-print.js';
import { gatherPluginStatus, type PluginsGather } from '../plugins/status-rows.js';

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
  // null while the plugins flag is off, so today's output stays byte-identical.
  plugins: () => Promise<PluginsGather | null>;
}

const defaultDeps: StatusDeps = {
  gather: (opts) => gatherStatus(resolveAuth({ token: opts.token }), siteFqdn()),
  plugins: () => (pluginsEnabled() ? gatherPluginStatus() : Promise.resolve(null)),
};

type PluginsOutcome = { gathered: PluginsGather | null; error: unknown };

const settle = async (deps: StatusDeps): Promise<PluginsOutcome> => {
  try {
    return { gathered: await deps.plugins(), error: null };
  } catch (error) {
    return { gathered: null, error };
  }
};

const emit = (report: StatusReport, gathered: PluginsGather | null, json?: boolean): void => {
  if (json) {
    console.log(JSON.stringify(gathered ? { ...report, ...gathered.status } : report, null, 2));
    return;
  }
  printStatus(report);
  for (const text of gathered ? pluginStatusLines(gathered.status) : []) console.log(text);
};

const profileFailure = (gathered: PluginsGather | null): Error | null => {
  const profile = gathered?.status.profile;
  if (profile?.state !== 'invalid') return null;
  return new Error(`profile.json is invalid:\n${profile.errors.map((e) => `  ${e}`).join('\n')}`);
};

// The report always prints; a plugin-side failure then fails the step (exit 1) on stderr.
export const runStatus = async (
  opts: StatusOptions = {},
  deps: StatusDeps = defaultDeps
): Promise<void> => {
  const report = await deps.gather(opts);
  const { gathered, error } = await settle(deps);
  emit(report, gathered, opts.json);
  for (const warning of gathered?.warnings ?? [])
    console.error(chalk.yellow(`warning: ${warning}`));
  if (error) throw error;
  const failure = profileFailure(gathered);
  if (failure) throw failure;
};

const PLUGINS_HELP = `
Plugins: one row per plugin in the profile or a dev path: id, state (installed, off,
blocked, invalid, missing), package, installed version, wanted range, contributed commands,
the last run from state/<id>.json, and the reason when it cannot load. Plugin code is never
loaded; the only file written is machine.json.`;

export const registerStatus = (
  program: Command,
  action: (opts: StatusOptions) => Promise<void>
): void => {
  const command = program
    .command('status')
    .description(
      pluginsEnabled()
        ? 'Show CLI, account, endpoint, machine, profile, and plugin status'
        : 'Show CLI, account, and endpoint status'
    )
    .option('--json', 'machine-readable output')
    .option(
      '--token <token>',
      'authenticate with a personal access token (aga_...); or set AGENTAGE_TOKEN'
    )
    .action(action);
  if (pluginsEnabled()) command.addHelpText('after', PLUGINS_HELP);
};
