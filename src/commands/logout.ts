import { type Command } from 'commander';
import chalk from 'chalk';

export const registerLogout = (program: Command): void => {
  program
    .command('logout')
    .description('Disconnect from hub')
    .action(() => {
      console.log(chalk.yellow('Hub sync not yet available.'));
    });
};
