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

const program = new Command();

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

program.parse();
