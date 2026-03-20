import { type Command } from 'commander';
import chalk from 'chalk';

export const registerLogin = (program: Command): void => {
  program
    .command('login')
    .description('Authenticate with hub')
    .option('--hub <url>', 'Hub URL')
    .action(() => {
      console.log(chalk.yellow('Hub sync not yet available.'));
    });
};
