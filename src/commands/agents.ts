import { type Command } from 'commander';
import chalk from 'chalk';
import { type AgentManifest } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get, post } from '../utils/daemon-client.js';

export const registerAgents = (program: Command): void => {
  program
    .command('agents')
    .description('List discovered agents')
    .option('--refresh', 'Rescan directories first')
    .option('--all', 'Show agents from all connected machines')
    .option('--json', 'JSON output')
    .action(async (opts: { refresh?: boolean; all?: boolean; json?: boolean }) => {
      await ensureDaemon();

      if (opts.all) {
        console.error(chalk.red("Not connected to hub. Run 'agentage login' first."));
        process.exitCode = 1;
        return;
      }

      let agents: AgentManifest[];
      if (opts.refresh) {
        agents = await post<AgentManifest[]>('/api/agents/refresh');
      } else {
        agents = await get<AgentManifest[]>('/api/agents');
      }

      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      if (agents.length === 0) {
        console.log(chalk.gray('No agents discovered.'));
        return;
      }

      const nameWidth = Math.max(12, ...agents.map((a) => a.name.length)) + 2;
      const descWidth = Math.max(12, ...agents.map((a) => (a.description || '').length)) + 2;

      console.log(
        chalk.bold('NAME'.padEnd(nameWidth)) +
          chalk.bold('DESCRIPTION'.padEnd(descWidth)) +
          chalk.bold('PATH')
      );

      for (const agent of agents) {
        console.log(
          agent.name.padEnd(nameWidth) +
            (agent.description || '').padEnd(descWidth) +
            chalk.gray(agent.path)
        );
      }
    });
};
