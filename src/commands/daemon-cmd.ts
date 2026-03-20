import { type Command } from 'commander';
import chalk from 'chalk';
import { getDaemonPid, restartDaemon, stopDaemon } from '../daemon/daemon.js';

export const registerDaemon = (program: Command): void => {
  const daemon = program.command('daemon').description('Manage the daemon');

  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(() => {
      const pid = getDaemonPid();
      if (pid === null) {
        console.log(chalk.gray('Daemon is not running.'));
        return;
      }
      stopDaemon();
      console.log(chalk.green('Daemon stopped.'));
    });

  daemon
    .command('restart')
    .description('Restart the daemon')
    .action(async () => {
      await restartDaemon();
      const pid = getDaemonPid();
      console.log(chalk.green(`Daemon restarted (PID ${pid}, port 4243).`));
    });
};
