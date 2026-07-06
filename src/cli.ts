#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerMemory } from './commands/memory.js';
import { registerSetup } from './commands/setup.js';
import { registerStatus } from './commands/status.js';
import { registerUpdate } from './commands/update.js';
import { registerVault } from './commands/vault.js';
import { VERSION } from './utils/version.js';

// Silence Node's "SQLite is an experimental feature" warning: it prints on every index
// command and the user cannot act on it.
const hushSqliteWarning = (): void => {
  const emit = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (message.includes('SQLite is an experimental feature')) return;
    (emit as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
};

// The vault index uses node:sqlite, which is behind --experimental-sqlite on Node < 23.4.
// For index-touching commands, re-exec once with the flag when the module can't load, so
// the CLI works across the whole Node >= 22 range. Non-index commands never pay for this.
// (Command modules load node:sqlite lazily, so importing them above stays flag-free.)
const bootstrapSqlite = (): void => {
  if (!process.argv.slice(2).some((a) => a === 'memory' || a === 'reindex')) return;
  hushSqliteWarning(); // install before requiring node:sqlite - the warning fires at load time
  const req = createRequire(import.meta.url);
  const loadable = ((): boolean => {
    try {
      req('node:sqlite');
      return true;
    } catch {
      return false;
    }
  })();
  if (loadable) return;
  if (process.execArgv.includes('--experimental-sqlite')) return;
  const result = spawnSync(
    process.execPath,
    ['--experimental-sqlite', process.argv[1] as string, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
};
bootstrapSqlite();

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
