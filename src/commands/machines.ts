import { type Command } from 'commander';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';

interface Machine {
  id: string;
  name: string;
  platform: string;
  status: string;
  last_seen_at: string;
  agents?: unknown[];
}

export const registerMachines = (program: Command): void => {
  program
    .command('machines')
    .description('List connected machines')
    .option('--json', 'JSON output')
    .action(async (opts: { json?: boolean }) => {
      await ensureDaemon();

      let machines: Machine[];
      try {
        machines = await get<Machine[]>('/api/hub/machines');
      } catch {
        console.error(chalk.red("Not connected to hub. Run 'agentage setup' first."));
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(machines, null, 2));
        return;
      }

      if (machines.length === 0) {
        console.log(chalk.gray('No machines registered.'));
        return;
      }

      const nameWidth = Math.max(12, ...machines.map((m) => m.name.length)) + 2;

      console.log(
        chalk.bold('NAME'.padEnd(nameWidth)) +
          chalk.bold('PLATFORM'.padEnd(12)) +
          chalk.bold('STATUS'.padEnd(12)) +
          chalk.bold('LAST SEEN')
      );

      for (const machine of machines) {
        const status = machine.status === 'online' ? chalk.green('online') : chalk.gray('offline');

        const lastSeen = formatLastSeen(machine.last_seen_at);

        console.log(
          machine.name.padEnd(nameWidth) +
            machine.platform.padEnd(12) +
            status.padEnd(12 + (status.length - machine.status.length)) +
            chalk.gray(lastSeen)
        );
      }
    });
};

const formatLastSeen = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
