import chalk from 'chalk';
import { type Command } from 'commander';
import {
  isDaemonRunning,
  resolvePort,
  signalPid,
  stopDaemonSafely,
} from '../../daemon/lifecycle.js';
import { health, mismatchNotice, spawnDaemon, syncStatus } from '../../lib/daemon/daemon-client.js';

const startAction = async (opts: { mcp?: boolean } = {}): Promise<void> => {
  const port = resolvePort();
  const existing = await health(port);
  if (existing) {
    console.log(chalk.gray(`Daemon already running (pid ${existing.pid}, port ${port}).`));
    return;
  }
  const noMcp = opts.mcp === false;
  const outcome = await spawnDaemon(port, { noMcp });
  if (!outcome.ok) {
    if (outcome.reason === 'port-in-use') {
      console.error(
        chalk.red(
          `Port ${port} is in use by another process - set AGENTAGE_DAEMON_PORT to use a different port.`
        )
      );
    } else {
      console.error(chalk.red('Daemon failed to start.'));
    }
    process.exitCode = 1;
    return;
  }
  const h = await health(port);
  const mcp = noMcp ? 'off' : 'on';
  console.log(chalk.green(`Daemon started (pid ${h?.pid ?? '?'}, port ${port}, mcp ${mcp}).`));
};

// Detect the daemon the same way `start` does (tokenless /health), so a legacy daemon that never
// wrote this config dir's pidfile is not misreported as "not running". With a pidfile we own, use
// the safe pid-confirming stop; otherwise fall back to signalling the pid /health reports, or - if
// none is available - report the truth rather than a false "not running".
const stopAction = async (): Promise<void> => {
  if (isDaemonRunning()) {
    if (await stopDaemonSafely()) console.log(chalk.green('Daemon stopped.'));
    return;
  }
  const port = resolvePort();
  const h = await health(port);
  if (!h) {
    console.log(chalk.gray('Daemon is not running.'));
    return;
  }
  if (typeof h.pid === 'number' && signalPid(h.pid)) {
    console.log(chalk.green(`Daemon stopped (pid ${h.pid}).`));
    return;
  }
  const who = typeof h.pid === 'number' ? `pid ${h.pid}` : `port ${port}`;
  console.error(
    chalk.yellow(
      `Daemon is running (${who}) but has no pidfile to stop it safely; stop it with: kill ${h.pid ?? '<pid>'}`
    )
  );
  process.exitCode = 1;
};

const statusAction = async (): Promise<void> => {
  const port = resolvePort();
  const h = await health(port);
  if (!h) {
    console.log(
      isDaemonRunning()
        ? chalk.yellow(`Daemon pid file present but unreachable on port ${port}.`)
        : chalk.gray('Daemon is not running.')
    );
    return;
  }
  console.log(`pid      ${h.pid ?? '?'}`);
  console.log(`port     ${port}`);
  if (typeof h.uptime === 'number') console.log(`uptime   ${h.uptime}s`);
  if (typeof h.served === 'number') console.log(`served   ${h.served}`);
  console.log(`mcp      ${h.mcp === false ? 'off' : 'on'}`);
  console.log(`version  ${h.version}`);
  const notice = mismatchNotice(h.version);
  if (notice) console.log(chalk.yellow(notice));

  const sync = await syncStatus(port);
  if (sync && sync.vaults.length > 0) {
    console.log('sync');
    for (const v of sync.vaults) {
      const cadence = v.intervalSeconds > 0 ? `every ${v.intervalSeconds}s` : 'manual';
      const state = v.running
        ? 'running'
        : v.lastError
          ? `error: ${v.lastError}`
          : v.lastRun
            ? `ok ${v.lastRun}`
            : 'scheduled';
      console.log(`  ${v.vault.padEnd(16)} ${cadence.padEnd(12)} ${state}`);
    }
  }
  if (sync?.couch && sync.couch.length > 0) {
    console.log('couch sync');
    for (const v of sync.couch) {
      const cadence = v.intervalSeconds > 0 ? `every ${v.intervalSeconds}s` : 'manual';
      const state = v.paused
        ? `paused: ${v.paused}`
        : v.running
          ? 'running'
          : v.lastError
            ? `error: ${v.lastError}`
            : v.lastSync
              ? `ok ${v.lastSync}`
              : 'scheduled';
      const pending = v.pendingCount > 0 ? `  ${v.pendingCount} pending` : '';
      console.log(`  ${v.vault.padEnd(16)} ${cadence.padEnd(12)} ${state}${pending}`);
    }
  }
  if (sync?.discover && sync.discover.roots.length > 0) {
    console.log(`discover roots (${sync.discover.roots.length})`);
    for (const root of sync.discover.roots) console.log(`  ${root}`);
  }
};

export const registerDaemon = (program: Command): void => {
  const daemon = program.command('daemon').description('Manage the local engine daemon');
  daemon
    .command('start')
    .description('Start the daemon (idempotent)')
    .option('--no-mcp', 'do not serve the local MCP endpoint at /mcp')
    .action((opts: { mcp?: boolean }) => startAction(opts));
  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(() => stopAction());
  daemon
    .command('status')
    .description('Show the daemon pid, uptime, and version')
    .action(() => statusAction());
};
