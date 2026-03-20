import { type Command } from 'commander';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';

export const registerMachines = (program: Command): void => {
  program
    .command('machines')
    .description('List connected machines')
    .option('--json', 'JSON output')
    .action(async () => {
      await ensureDaemon();
      console.error(chalk.red("Not connected to hub. Run 'agentage login' first."));
      process.exitCode = 1;
    });
};
