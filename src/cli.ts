#!/usr/bin/env node

import { Command } from 'commander';
import { registerMemory } from './commands/memory.js';
import { registerSetup } from './commands/setup.js';
import { registerStatus } from './commands/status.js';
import { registerUpdate } from './commands/update.js';
import { registerVault } from './commands/vault.js';
import { VERSION } from './utils/version.js';

const program = new Command();

program.name('agentage').description('The agentage CLI').version(VERSION);

registerSetup(program);
registerStatus(program);
registerVault(program);
registerMemory(program);
registerUpdate(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
