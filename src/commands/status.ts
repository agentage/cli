import { type Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { loadConfig, saveConfig } from '../daemon/config.js';

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
    .option('--add-dir <path>', 'Add directory to agent discovery')
    .option('--remove-dir <path>', 'Remove directory from agent discovery')
    .action(async (opts: { addDir?: string; removeDir?: string }) => {
      if (opts.addDir) {
        handleAddDir(opts.addDir);
        return;
      }

      if (opts.removeDir) {
        handleRemoveDir(opts.removeDir);
        return;
      }

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

      const config = loadConfig();
      const dirs = config.discovery.dirs;
      if (dirs.length > 0) {
        console.log(`Discovery:  ${dirs[0]}`);
        for (const dir of dirs.slice(1)) {
          console.log(`            ${dir}`);
        }
      } else {
        console.log('Discovery:  (none)');
      }

      process.exit(0);
    });
};

const handleAddDir = (path: string): void => {
  const absolute = resolve(path);
  const config = loadConfig();
  if (config.discovery.dirs.includes(absolute)) {
    console.log(chalk.yellow(`Directory already in discovery: ${absolute}`));
    process.exit(0);
    return;
  }
  config.discovery.dirs.push(absolute);
  saveConfig(config);
  console.log(chalk.green(`Added discovery directory: ${absolute}`));
  process.exit(0);
};

const handleRemoveDir = (path: string): void => {
  const absolute = resolve(path);
  const config = loadConfig();
  config.discovery.dirs = config.discovery.dirs.filter((d) => d !== absolute);
  saveConfig(config);
  console.log(chalk.green(`Removed discovery directory: ${absolute}`));
  process.exit(0);
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};
