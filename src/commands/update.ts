import { type Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from '../daemon/config.js';
import { isDaemonRunning, restartDaemon, getDaemonPid } from '../daemon/daemon.js';
import { checkForUpdate } from '../utils/update-checker.js';

const LOCK_FILE = 'update.lock';

const getLockPath = (): string => join(getConfigDir(), LOCK_FILE);

const acquireLock = (): boolean => {
  const lockPath = getLockPath();
  if (existsSync(lockPath)) {
    return false;
  }
  writeFileSync(lockPath, String(process.pid), 'utf-8');
  return true;
};

const releaseLock = (): void => {
  const lockPath = getLockPath();
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
};

export const registerUpdate = (program: Command): void => {
  program
    .command('update')
    .description('Update @agentage/cli to the latest version')
    .option('--check', 'Only check for updates, do not install')
    .action(async (opts: { check?: boolean }) => {
      try {
        console.log(chalk.gray('Checking for updates...'));
        const result = await checkForUpdate({ force: true });

        if (!result.updateAvailable) {
          console.log(chalk.green(`Already on the latest version (${result.currentVersion}).`));
          process.exit(0);
          return;
        }

        console.log(
          `Update available: ${chalk.gray(result.currentVersion)} → ${chalk.green(result.latestVersion)}`
        );

        if (opts.check) {
          console.log(chalk.gray(`Run ${chalk.white('agentage update')} to install.`));
          process.exit(0);
          return;
        }

        if (!acquireLock()) {
          console.log(chalk.yellow('Another update is already in progress.'));
          process.exit(1);
          return;
        }

        try {
          console.log(chalk.gray('Installing update...'));
          execSync('npm update -g @agentage/cli', {
            stdio: 'inherit',
            timeout: 120_000,
          });

          console.log(chalk.green(`Updated to ${result.latestVersion}.`));

          if (isDaemonRunning()) {
            console.log(chalk.gray('Restarting daemon...'));
            await restartDaemon();
            const pid = getDaemonPid();
            console.log(chalk.green(`Daemon restarted (PID ${pid}).`));
          }
        } finally {
          releaseLock();
        }
      } catch (err) {
        releaseLock();
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Update failed: ${message}`));
        process.exit(1);
      }

      process.exit(0);
    });
};
