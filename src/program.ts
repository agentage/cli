import chalk from 'chalk';
import { Command } from 'commander';
import { registerSetup } from './commands/auth/setup.js';
import { registerStatus } from './commands/status/status.js';
import { registerUpdate } from './commands/update/update.js';
import { refreshUpdateCache, updateHint } from './lib/update/update-cache.js';
import { VERSION } from './utils/version.js';

const program = new Command();

program
  .name('agentage')
  .description('Connect this machine to agentage from the terminal')
  .version(VERSION);

program.addHelpText('after', '\nNew here? Run: agentage setup to connect this machine.');

// After any command (except the update-aware ones, which report richer state themselves), print a
// one-line hint from the cache, then kick a fire-and-forget refresh. Never awaited, never throws -
// the command output is already done and the cache-only read keeps this instant. The hint is
// suppressed under --json so it never corrupts machine-readable output.
program.hook('postAction', (_thisCommand, actionCommand) => {
  const name = actionCommand.name();
  if (name === 'status' || name === 'update') return;
  if (!actionCommand.opts()['json']) {
    const hint = updateHint();
    if (hint) console.error(chalk.dim(hint)); // stderr: never corrupt piped stdout
  }
  void refreshUpdateCache();
});

registerSetup(program);
registerStatus(program);
registerUpdate(program);

// Called by the bin (src/cli.ts).
export const run = async (): Promise<void> => {
  await program.parseAsync().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
};
