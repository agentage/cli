import { type Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { ensureDaemon } from '../utils/ensure-daemon.js';

export const registerInit = (program: Command): void => {
  program
    .command('init')
    .description('Initialize agentage setup')
    .option('--hub <url>', 'Set hub URL')
    .option('--name <name>', 'Set machine name')
    .option('--dir <path>', 'Add to agents.additional')
    .option('--no-login', 'Skip login step')
    .action(async (opts: { hub?: string; name?: string; dir?: string; login: boolean }) => {
      const config = loadConfig();
      const steps: string[] = [];

      // Step 1: Machine name
      if (opts.name) {
        config.machine.name = opts.name;
        steps.push(`Machine name: ${opts.name}`);
      }

      // Step 2: Additional agents dir
      if (opts.dir) {
        const absolute = resolve(opts.dir);
        if (config.agents.default !== absolute && !config.agents.additional.includes(absolute)) {
          config.agents.additional.push(absolute);
        }
        steps.push(`Agents dir: ${absolute}`);
      }

      // Step 3: Hub URL
      if (opts.hub) {
        const hubUrl = opts.hub.startsWith('http') ? opts.hub : `https://${opts.hub}`;
        config.hub = { url: hubUrl };
        steps.push(`Hub URL: ${hubUrl}`);
      }

      saveConfig(config);

      // Step 4: Start daemon
      await ensureDaemon();
      steps.push('Daemon: started');

      // Step 5: Login hint
      if (opts.hub && opts.login) {
        steps.push(`Login: run 'agentage login --hub ${opts.hub}' to authenticate`);
      }

      // Summary
      console.log(chalk.green('Agentage initialized:'));
      for (const step of steps) {
        console.log(`  ${step}`);
      }

      console.log(chalk.dim(`\nConfig: machine=${config.machine.name}, id=${config.machine.id}`));
    });
};
