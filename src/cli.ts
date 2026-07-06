#!/usr/bin/env node

import { Command } from 'commander';
import { registerDaemon } from './commands/daemon-cmd.js';
import { registerMcp } from './commands/mcp.js';
import { registerMemory } from './commands/memory.js';
import { registerSetup } from './commands/setup.js';
import { registerStatus } from './commands/status.js';
import { registerUpdate } from './commands/update.js';
import { registerVault } from './commands/vault.js';
import { disableDaemon } from './lib/daemon-pref.js';
import { VERSION } from './utils/version.js';

const program = new Command();

program
  .name('agentage')
  .description('The agentage CLI')
  .version(VERSION)
  .option('--no-daemon', 'run memory verbs in-process instead of via the daemon');

program.hook('preAction', () => {
  if (program.opts().daemon === false) disableDaemon();
});

registerSetup(program);
registerStatus(program);
registerVault(program);
registerMemory(program);
registerDaemon(program);
registerMcp(program);
registerUpdate(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
