import chalk from 'chalk';
import { type Command } from 'commander';
import { type TreeEntry } from '@agentage/memory-core';
import { createDirectClient, type MemoryClient } from '../lib/memory-client.js';
import { loadVaultsConfig } from '../lib/vaults.js';

const defaultClient = (): MemoryClient => createDirectClient(loadVaultsConfig().config);

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
};

const emit = (json: boolean, data: unknown, human: () => void): void => {
  if (json) console.log(JSON.stringify(data, null, 2));
  else human();
};

// Flatten a folder-tree to the file paths it contains, in tree order.
const treeFiles = (entries: TreeEntry[]): string[] =>
  entries.flatMap((e) => (e.type === 'file' ? [e.path] : e.entries ? treeFiles(e.entries) : []));

interface CommonOpts {
  vault?: string;
  json?: boolean;
}

export const runSearch = async (
  query: string,
  opts: CommonOpts & { limit?: string },
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const out = await client.search(query, {
    vault: opts.vault,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
  });
  emit(opts.json ?? false, out, () => {
    if (out.results.length === 0) console.log('No matches.');
    for (const h of out.results) console.log(`${h.path}\n  ${chalk.gray(h.snippet)}`);
  });
};

export const runRead = async (
  ref: string,
  opts: CommonOpts,
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const doc = await client.read(ref, { vault: opts.vault });
  emit(opts.json ?? false, doc, () => console.log(doc.body));
};

export const runWrite = async (
  ref: string,
  opts: CommonOpts & { body?: string; frontmatter?: string },
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const body = opts.body !== undefined && opts.body !== '-' ? opts.body : await readStdin();
  const frontmatter = opts.frontmatter
    ? (JSON.parse(opts.frontmatter) as Record<string, unknown>)
    : undefined;
  const out = await client.write(ref, body, { vault: opts.vault, frontmatter });
  emit(opts.json ?? false, out, () => console.log(chalk.green(`Wrote ${out.path}`)));
};

export const runEdit = async (
  ref: string,
  opts: CommonOpts & { old?: string; new?: string; body?: string; append?: boolean },
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const op =
    opts.old !== undefined
      ? { mode: 'str_replace' as const, old_str: opts.old, new_str: opts.new ?? '' }
      : { mode: opts.append ? ('append' as const) : ('replace' as const), body: opts.body };
  const out = await client.edit(ref, op, { vault: opts.vault });
  emit(opts.json ?? false, out, () => console.log(chalk.green(`Edited ${out.path}`)));
};

export const runList = async (
  folder: string | undefined,
  opts: CommonOpts,
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const out = await client.list(folder, { vault: opts.vault });
  emit(opts.json ?? false, out, () => {
    const files = treeFiles(out.entries);
    if (files.length === 0) console.log('No documents.');
    for (const p of files) console.log(p);
  });
};

export const runDelete = async (
  ref: string,
  opts: CommonOpts,
  client: MemoryClient = defaultClient()
): Promise<void> => {
  const out = await client.delete(ref, { vault: opts.vault });
  emit(opts.json ?? false, out, () =>
    console.log(`Deleted ${out.path} (recoverable from git history)`)
  );
};

const guard = (fn: () => Promise<void>): Promise<void> =>
  fn().catch((err: unknown) => {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
