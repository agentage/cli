import { type Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get } from '../utils/daemon-client.js';
import { getDaemonPid } from '../daemon/daemon.js';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { checkForUpdateSafe } from '../utils/update-checker.js';
import { loadProjects } from '../projects/projects.js';

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
    .option('--add-dir <path>', 'Add directory to agents.additional')
    .option('--remove-dir <path>', 'Remove directory from agents.additional')
    .option('--set-default <path>', 'Set agents.default (install target)')
    .option('--json', 'JSON output')
    .action(
      async (opts: {
        addDir?: string;
        removeDir?: string;
        setDefault?: string;
        json?: boolean;
      }) => {
        if (opts.addDir) {
          handleAddDir(opts.addDir);
          return;
        }

        if (opts.removeDir) {
          handleRemoveDir(opts.removeDir);
          return;
        }

        if (opts.setDefault) {
          handleSetDefault(opts.setDefault);
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

        const projects = loadProjects();

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
                projects: projects.length,
                runs: runs.length,
                agentsDefault: config.agents.default,
                agentsAdditional: config.agents.additional,
                projectsDefault: config.projects.default,
                projectsAdditional: config.projects.additional,
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

        console.log(
          `Daemon:     ${chalk.green('running')} (PID ${pid}, port ${config.daemon.port})`
        );
        const versionLine = updateCheck?.updateAvailable
          ? `${health.version} ${chalk.yellow(`→ ${updateCheck.latestVersion} available`)} ${chalk.dim('(run `agentage update`)')}`
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
        console.log(`Projects:   ${projects.length} registered`);
        console.log(`Runs:       ${activeRuns} active`);

        console.log(`Agents:     ${config.agents.default} ${chalk.dim('(default)')}`);
        for (const dir of config.agents.additional) {
          console.log(`            ${dir}`);
        }
        console.log(`Projects:   ${config.projects.default} ${chalk.dim('(default)')}`);
        for (const dir of config.projects.additional) {
          console.log(`            ${dir}`);
        }

        process.exit(0);
      }
    );
};

const handleAddDir = (path: string): void => {
  const absolute = resolve(path);
  const config = loadConfig();
  if (config.agents.default === absolute || config.agents.additional.includes(absolute)) {
    console.log(chalk.yellow(`Directory already configured: ${absolute}`));
    process.exit(0);
    return;
  }
  config.agents.additional.push(absolute);
  saveConfig(config);
  console.log(chalk.green(`Added agents directory: ${absolute}`));
  process.exit(0);
};

const handleRemoveDir = (path: string): void => {
  const absolute = resolve(path);
  const config = loadConfig();
  if (config.agents.default === absolute) {
    console.error(
      chalk.red(`Cannot remove default directory. Use --set-default to change it first.`)
    );
    process.exit(1);
    return;
  }
  config.agents.additional = config.agents.additional.filter((d) => d !== absolute);
  saveConfig(config);
  console.log(chalk.green(`Removed agents directory: ${absolute}`));
  process.exit(0);
};

const handleSetDefault = (path: string): void => {
  const absolute = resolve(path);
  const config = loadConfig();
  const previousDefault = config.agents.default;
  if (previousDefault === absolute) {
    console.log(chalk.yellow(`Already the default: ${absolute}`));
    process.exit(0);
    return;
  }
  config.agents.additional = config.agents.additional.filter((d) => d !== absolute);
  if (previousDefault && !config.agents.additional.includes(previousDefault)) {
    config.agents.additional.unshift(previousDefault);
  }
  config.agents.default = absolute;
  saveConfig(config);
  console.log(chalk.green(`Set agents default: ${absolute}`));
  console.log(chalk.dim(`Previous default moved to additional: ${previousDefault}`));
  process.exit(0);
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};
