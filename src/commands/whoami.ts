import { type Command } from 'commander';
import chalk from 'chalk';
import { readAuth } from '../hub/auth.js';
import { loadConfig } from '../daemon/config.js';

interface WhoamiData {
  loggedIn: boolean;
  email: string | null;
  hubUrl: string | null;
  machineName: string;
  machineId: string;
}

const getWhoamiData = (): WhoamiData => {
  const config = loadConfig();
  const auth = readAuth();

  return {
    loggedIn: !!auth,
    email: auth?.user?.email ?? null,
    hubUrl: auth?.hub?.url ?? config.hub?.url ?? null,
    machineName: config.machine.name,
    machineId: config.machine.id,
  };
};

export const registerWhoami = (program: Command): void => {
  program
    .command('whoami')
    .description('Show current user and machine info')
    .option('--json', 'JSON output')
    .action((opts: { json?: boolean }) => {
      const data = getWhoamiData();

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.loggedIn) {
        console.log(`Email:    ${chalk.green(data.email!)}`);
        console.log(`Hub:      ${data.hubUrl}`);
      } else {
        console.log(`Email:    ${chalk.yellow('Not logged in')}`);
      }

      console.log(`Machine:  ${data.machineName} (${data.machineId})`);
    });
};
