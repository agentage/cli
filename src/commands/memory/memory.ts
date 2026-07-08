import chalk from 'chalk';
import { type Command } from 'commander';
import { translateEngineMessage } from '../../lib/memory/memory-client.js';
import {
  type CommonOpts,
  runDelete,
  runEdit,
  runList,
  runRead,
  runSearch,
  runWrite,
} from './memory-verbs.js';

const guard = (fn: () => Promise<void>): Promise<void> =>
  fn().catch((err: unknown) => {
    const message = translateEngineMessage(err instanceof Error ? err.message : String(err));
    console.error(chalk.red(message));
    process.exitCode = 1;
  });

export const registerMemory = (program: Command): void => {
  const memory = program.command('memory').description('Read + write memory, offline');

  memory
    .command('search <query...>')
    .description('Search a vault (git grep)')
    .option('--vault <name>', 'target vault')
    .option('--limit <n>', 'max hits (default 20)')
    .option('--json', 'machine-readable output')
    .action((query: string[], opts: CommonOpts & { limit?: string }) =>
      guard(() => runSearch(query.join(' '), opts))
    );

  memory
    .command('read <ref>')
    .description('Print a document (@<vault>/<path> or <path> --vault)')
    .option('--vault <name>', 'target vault')
    .option('--json', 'machine-readable output')
    .action((ref: string, opts: CommonOpts) => guard(() => runRead(ref, opts)));

  memory
    .command('write <ref>')
    .description('Create or overwrite a document (body from --body or stdin)')
    .option('--vault <name>', 'target vault')
    .option('--body <text>', 'document body (omit or "-" to read stdin)')
    .option('--frontmatter <json>', 'frontmatter as a JSON object')
    .option('--json', 'machine-readable output')
    .action((ref: string, opts: CommonOpts & { body?: string; frontmatter?: string }) =>
      guard(() => runWrite(ref, opts))
    );

  memory
    .command('edit <ref>')
    .description('Edit a document: str_replace (--old/--new) or --body (--append)')
    .option('--vault <name>', 'target vault')
    .option('--old <str>', 'exact, unique substring to replace')
    .option('--new <str>', 'replacement (omit to delete the match)')
    .option('--body <text>', 'replace the whole body')
    .option('--append', 'append --body instead of replacing')
    .option('--json', 'machine-readable output')
    .action(
      (
        ref: string,
        opts: CommonOpts & { old?: string; new?: string; body?: string; append?: boolean }
      ) => guard(() => runEdit(ref, opts))
    );

  memory
    .command('list [folder]')
    .description('List documents in a vault (optionally under a folder)')
    .option('--vault <name>', 'target vault')
    .option('--json', 'machine-readable output')
    .action((folder: string | undefined, opts: CommonOpts) => guard(() => runList(folder, opts)));

  memory
    .command('delete <ref>')
    .description('Delete a document (recoverable from git history)')
    .option('--vault <name>', 'target vault')
    .option('--json', 'machine-readable output')
    .action((ref: string, opts: CommonOpts) => guard(() => runDelete(ref, opts)));
};
