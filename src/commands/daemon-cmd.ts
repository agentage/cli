import chalk from 'chalk';
import { type Command } from 'commander';
import { isDaemonRunning, resolvePort, stopDaemonSafely } from '../daemon/lifecycle.js';
import { health, mismatchNotice, spawnDaemon, syncStatus } from '../lib/daemon-client.js';

const startAction = async (): Promise<void> => {
  const port = resolvePort();
  const existing = await health(port);
  if (existing) {
    console.log(chalk.gray(`Daemon already running (pid ${existing.pid}, port ${port}).`));
    return;
  }
  const outcome = await spawnDaemon(port);
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
  console.log(chalk.green(`Daemon started (pid ${h?.pid ?? '?'}, port ${port}).`));
};

const stopAction = async (): Promise<void> => {
  if (!isDaemonRunning()) {
    console.log(chalk.gray('Daemon is not running.'));
    return;
  }
  if (await stopDaemonSafely()) console.log(chalk.green('Daemon stopped.'));
};

const statusAction = async (): Promise<void> => {
  if (!isDaemonRunning()) {
    console.log(chalk.gray('Daemon is not running.'));
    return;
  }
  const port = resolvePort();
  const h = await health(port);
  if (!h) {
    console.log(chalk.yellow(`Daemon pid file present but unreachable on port ${port}.`));
    return;
  }
  console.log(`pid      ${h.pid}`);
  console.log(`port     ${port}`);
  console.log(`uptime   ${h.uptime}s`);
  console.log(`served   ${h.served}`);
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
    .action(() => startAction());
  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(() => stopAction());
  daemon
    .command('status')
    .description('Show the daemon pid, uptime, and version')
    .action(() => statusAction());
};
