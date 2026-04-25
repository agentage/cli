#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './utils/version.js';
import { registerRun } from './commands/run.js';
import { registerAgents } from './commands/agents.js';
import { registerRuns } from './commands/runs.js';
import { registerMachines } from './commands/machines.js';
import { registerStatus } from './commands/status.js';
import { registerLogs } from './commands/logs.js';
import { registerDaemon } from './commands/daemon-cmd.js';
import { registerWhoami } from './commands/whoami.js';
import { registerCompletions } from './commands/completions.js';
import { registerConfig } from './commands/config-cmd.js';
import { registerSetup } from './commands/setup.js';
import { createCreateCommand } from './commands/create.js';
import { registerUpdate } from './commands/update.js';
import { registerProjects } from './commands/projects.js';
import { registerSchedules } from './commands/schedules.js';
import { registerVaults } from './commands/vault.js';
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
registerLogs(program);
registerDaemon(program);
registerWhoami(program);
registerCompletions(program);
registerConfig(program);
registerSetup(program);
program.addCommand(createCreateCommand());
registerUpdate(program);
registerProjects(program);
registerSchedules(program);
registerVaults(program);

// Show the update notice only on an interactive terminal. Appending it to
// non-TTY stdout (CI, pipes, `--json` consumers) corrupts machine-readable
// output — the e2e nightly's standalone suite hit exactly this when
// `latest` advanced past the installed version mid-run. The user can also
// opt out explicitly with NO_UPDATE_NOTIFIER (matching the npm convention).
const shouldShowUpdateNotice = (): boolean =>
  process.stdout.isTTY === true && !process.env['NO_UPDATE_NOTIFIER'];

program.parseAsync().then(async () => {
  if (shouldShowUpdateNotice()) {
    const result = await updateCheckPromise;
    if (result?.updateAvailable) {
      const { default: chalk } = await import('chalk');
      console.log(
        chalk.yellow(
          `\nUpdate available: ${result.currentVersion} → ${result.latestVersion} — run ${chalk.white('agentage update')} to install.`
        )
      );
    }
  }

  // Force exit — forked daemon process can keep the event loop alive
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
});
