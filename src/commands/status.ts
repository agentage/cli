import { type Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { checkForUpdateSafe } from '../utils/update-checker.js';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  machineId: string;
  hubConnected: boolean;
  hubConnecting: boolean;
  hubUrl: string | null;
  userEmail: string | null;
}

export const registerStatus = (program: Command): void => {
  program
    .command('status')
    .description('Show daemon and connection status')
    .option('--add-dir <path>', 'Add directory to agent discovery')
    .option('--remove-dir <path>', 'Remove directory from agent discovery')
    .option('--json', 'JSON output')
    .action(async (opts: { addDir?: string; removeDir?: string; json?: boolean }) => {
      if (opts.addDir) {
        handleAddDir(opts.addDir);
        return;
      }

      if (opts.removeDir) {
        handleRemoveDir(opts.removeDir);
        return;
      }

      await ensureDaemon();
      const [health, agents, runs, updateCheck] = await Promise.all([
        get<HealthResponse>('/api/health'),
        get<unknown[]>('/api/agents'),
        get<unknown[]>('/api/runs'),
        checkForUpdateSafe(),
      ]);
      const pid = getDaemonPid();
      const config = loadConfig();
      const dirs = config.discovery.dirs;

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              daemon: { status: 'running', pid, port: config.daemon.port },
              version: {
                current: health.version,
                latest: updateCheck?.latestVersion ?? null,
                updateAvailable: updateCheck?.updateAvailable ?? false,
              },
              uptime: health.uptime,
              hub: {
                connected: health.hubConnected,
                connecting: health.hubConnecting,
                url: health.hubUrl,
                userEmail: health.userEmail,
              },
              machine: health.machineId,
              agents: agents.length,
              runs: runs.length,
              discoveryDirs: dirs,
            },
            null,
            2
          )
        );
        process.exit(0);
        return;
      }

      const uptime = formatUptime(health.uptime);
      const activeRuns = runs.length;

      console.log(`Daemon:     ${chalk.green('running')} (PID ${pid}, port 4243)`);
      const versionLine = updateCheck?.updateAvailable
        ? `${health.version} ${chalk.yellow(`→ ${updateCheck.latestVersion} available`)}`
        : health.version;
      console.log(`Version:    ${versionLine}`);
      console.log(`Uptime:     ${uptime}`);

      if (health.hubConnected) {
        console.log(`Hub:        ${chalk.green('connected')} (${health.hubUrl})`);
        console.log(`User:       ${health.userEmail}`);
      } else if (health.hubConnecting) {
        console.log(`Hub:        ${chalk.cyan('connecting')} (${health.hubUrl})`);
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
