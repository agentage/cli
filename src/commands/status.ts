import { type Command } from 'commander';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  machineId: string;
  hubConnected: boolean;
  hubUrl: string | null;
  userEmail: string | null;
}

export const registerStatus = (program: Command): void => {
  program
    .command('status')
    .description('Show daemon and connection status')
    .action(async () => {
      await ensureDaemon();
      const health = await get<HealthResponse>('/api/health');
      const agents = await get<unknown[]>('/api/agents');
      const runs = await get<unknown[]>('/api/runs');
      const pid = getDaemonPid();

      const uptime = formatUptime(health.uptime);
      const activeRuns = runs.length;

      console.log(`Daemon:     ${chalk.green('running')} (PID ${pid}, port 4243)`);
      console.log(`Uptime:     ${uptime}`);

      if (health.hubConnected) {
        console.log(`Hub:        ${chalk.green('connected')} (${health.hubUrl})`);
        console.log(`User:       ${health.userEmail}`);
      } else if (health.hubUrl) {
        console.log(`Hub:        ${chalk.yellow('disconnected')} (${health.hubUrl})`);
        console.log(`User:       ${health.userEmail}`);
      } else {
        console.log(`Hub:        ${chalk.yellow('not connected (standalone mode)')}`);
      }

      console.log(`Machine:    ${health.machineId}`);
      console.log(`Agents:     ${agents.length} discovered`);
      console.log(`Runs:       ${activeRuns} active`);
      process.exit(0);
    });
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};
