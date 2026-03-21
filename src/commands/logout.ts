import { type Command } from 'commander';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { readAuth, deleteAuth } from '../hub/auth.js';
import { createHubClient } from '../hub/hub-client.js';

export const registerLogout = (program: Command): void => {
  program
    .command('logout')
    .description('Disconnect from hub')
    .action(async () => {
      await ensureDaemon();

      const auth = readAuth();
      if (!auth) {
        console.log(chalk.yellow('Not logged in.'));
        return;
      }

      // Best-effort deregister from hub
      try {
        const client = createHubClient(auth.hub.url, auth);
        await client.deregister(auth.hub.machineId);
      } catch {
        // Hub may be unreachable — that's fine
      }

      deleteAuth();

      console.log(chalk.green('Disconnected from hub. Machine deregistered.'));
      console.log(chalk.dim('Daemon continues running in standalone mode.'));
      console.log(chalk.dim('Run `agentage daemon restart` to apply.'));
    });
};
