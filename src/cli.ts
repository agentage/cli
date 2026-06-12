#!/usr/bin/env node

import { Command } from 'commander';
import { registerSetup } from './commands/setup.js';
import { registerStatus } from './commands/status.js';
import { VERSION } from './utils/version.js';

const program = new Command();

program.name('agentage').description('The agentage CLI').version(VERSION);

registerSetup(program);
registerStatus(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
