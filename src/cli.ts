#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { registerDaemon } from './commands/daemon-cmd.js';
import { registerMcp } from './commands/mcp.js';
import { registerMemory } from './commands/memory.js';
import { registerSetup } from './commands/setup.js';
import { registerStatus } from './commands/status.js';
import { registerUpdate } from './commands/update.js';
import { registerVault } from './commands/vault.js';
import { disableDaemon } from './lib/daemon-pref.js';
import { refreshUpdateCache, updateHint } from './lib/update-cache.js';
import { VERSION } from './utils/version.js';

// Dependency-free guard so the message survives even if deps fail to parse on old Node.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  process.stderr.write(`agentage requires Node.js >= 22 (you have v${process.versions.node})\n`);
  process.exit(1);
}

const program = new Command();

program
  .name('agentage')
  .description('The agentage CLI')
  .version(VERSION)
  .option('--no-daemon', 'run memory verbs in-process instead of via the daemon');

program.hook('preAction', () => {
  if (program.opts().daemon === false) disableDaemon();
});

// After any command (except the update-aware ones, which report richer state themselves), print a
// one-line hint from the cache, then kick a fire-and-forget refresh. Never awaited, never throws -
// the command output is already done and the cache-only read keeps this instant. The hint is
// suppressed under --json so it never corrupts machine-readable output.
program.hook('postAction', (_thisCommand, actionCommand) => {
  const name = actionCommand.name();
  if (name === 'status' || name === 'update') return;
  if (!actionCommand.opts()['json']) {
    const hint = updateHint();
    if (hint) console.log(chalk.dim(hint));
  }
  void refreshUpdateCache();
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
