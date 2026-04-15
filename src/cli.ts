#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './utils/version.js';
import { registerRun } from './commands/run.js';
import { registerAgents } from './commands/agents.js';
import { registerRuns } from './commands/runs.js';
import { registerMachines } from './commands/machines.js';
import { registerStatus } from './commands/status.js';
import { registerLogin } from './commands/login.js';
import { registerLogout } from './commands/logout.js';
import { registerLogs } from './commands/logs.js';
import { registerDaemon } from './commands/daemon-cmd.js';
import { registerWhoami } from './commands/whoami.js';
import { registerCompletions } from './commands/completions.js';
import { registerConfig } from './commands/config-cmd.js';
import { registerInit } from './commands/init.js';
import { createCreateCommand } from './commands/create.js';
import { registerUpdate } from './commands/update.js';
import { registerProjects } from './commands/projects.js';
import { registerSchedules } from './commands/schedules.js';
import { checkForUpdateSafe, type UpdateCheckResult } from './utils/update-checker.js';

const program = new Command();

// Kick off background update check (non-blocking)
const updateCheckPromise: Promise<UpdateCheckResult | null> = checkForUpdateSafe();

program.name('agentage').description('Agentage CLI — control plane for AI agents').version(VERSION);

registerRun(program);
registerAgents(program);
registerRuns(program);
registerMachines(program);
registerStatus(program);
registerLogin(program);
registerLogout(program);
registerLogs(program);
registerDaemon(program);
registerWhoami(program);
registerCompletions(program);
registerConfig(program);
registerInit(program);
program.addCommand(createCreateCommand());
registerUpdate(program);
registerProjects(program);
registerSchedules(program);

program.parseAsync().then(async () => {
  // Show update notice if a newer version is available
  const result = await updateCheckPromise;
  if (result?.updateAvailable) {
    const { default: chalk } = await import('chalk');
    console.log(
      chalk.yellow(
        `\nUpdate available: ${result.currentVersion} → ${result.latestVersion} — run ${chalk.white('agentage update')} to install.`
      )
    );
  }

  // Force exit — forked daemon process can keep the event loop alive
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
});
