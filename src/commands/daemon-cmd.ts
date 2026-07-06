import chalk from 'chalk';
import { type Command } from 'commander';
import { isDaemonRunning, resolvePort, stopDaemon } from '../daemon/lifecycle.js';
import { health, mismatchNotice, spawnDaemon } from '../lib/daemon-client.js';

const startAction = async (): Promise<void> => {
  const port = resolvePort();
  const existing = await health(port);
  if (existing) {
    console.log(chalk.gray(`Daemon already running (pid ${existing.pid}, port ${port}).`));
    return;
  }
  if (!(await spawnDaemon(port))) {
    console.error(chalk.red('Daemon failed to start.'));
    process.exitCode = 1;
    return;
  }
  const h = await health(port);
  console.log(chalk.green(`Daemon started (pid ${h?.pid ?? '?'}, port ${port}).`));
};

const stopAction = (): void => {
  if (!isDaemonRunning()) {
    console.log(chalk.gray('Daemon is not running.'));
    return;
  }
  stopDaemon();
  console.log(chalk.green('Daemon stopped.'));
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
};

export const registerDaemon = (program: Command): void => {
  const daemon = program.command('daemon').description('Manage the local engine daemon');
  daemon
    .command('start')
    .description('Start the daemon (idempotent)')
    .action(() => startAction());
  daemon.command('stop').description('Stop the daemon').action(stopAction);
  daemon
    .command('status')
    .description('Show the daemon pid, uptime, and version')
    .action(() => statusAction());
};
