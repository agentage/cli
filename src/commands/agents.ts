import { type Command } from 'commander';
import chalk from 'chalk';
import { type AgentManifest } from '@agentage/core';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get, post } from '../utils/daemon-client.js';
import { type ScanWarning } from '../discovery/scanner.js';

interface HubAgent {
  name: string;
  description?: string;
  version?: string;
  machines?: { name: string; status: string };
}

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
        await listHubAgents(opts.json ?? false);
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
        const desc = (agent.description || '').substring(0, 60);
        console.log(agent.name.padEnd(nameWidth) + desc.padEnd(descWidth) + chalk.gray(agent.path));
      }

      console.log(chalk.dim(`\n${agents.length} agents discovered`));

      try {
        const warnings = await get<ScanWarning[]>('/api/agents/warnings');
        if (warnings.length > 0) {
          console.log(chalk.yellow(`\n⚠ Failed to load ${warnings.length} agent(s):`));
          for (const w of warnings) {
            console.log(chalk.yellow(`  ${w.file}`));
            console.log(chalk.dim(`    ${w.message}`));
          }
        }
      } catch {
        // Daemon may not support warnings endpoint yet
      }
    });
};

const listHubAgents = async (jsonMode: boolean): Promise<void> => {
  let agents: HubAgent[];
  try {
    agents = await get<HubAgent[]>('/api/hub/agents');
  } catch {
    console.error(chalk.red("Not connected to hub. Run 'agentage setup' first."));
    process.exitCode = 1;
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log(chalk.gray('No agents found across machines.'));
    return;
  }

  const nameWidth = Math.max(12, ...agents.map((a) => a.name.length)) + 2;
  const machineWidth = Math.max(10, ...agents.map((a) => (a.machines?.name || '').length)) + 2;
  const descWidth =
    Math.max(12, ...agents.map((a) => (a.description || '').length).slice(0, 40)) + 2;

  console.log(
    chalk.bold('NAME'.padEnd(nameWidth)) +
      chalk.bold('MACHINE'.padEnd(machineWidth)) +
      chalk.bold('DESCRIPTION'.padEnd(descWidth)) +
      chalk.bold('STATUS')
  );

  for (const agent of agents) {
    const machineName = agent.machines?.name || '';
    const status =
      agent.machines?.status === 'online' ? chalk.green('online') : chalk.gray('offline');

    console.log(
      agent.name.padEnd(nameWidth) +
        machineName.padEnd(machineWidth) +
        (agent.description || '').substring(0, 38).padEnd(descWidth) +
        status
    );
  }
};
