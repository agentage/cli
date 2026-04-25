import { resolve } from 'node:path';
import chalk from 'chalk';
import { type Command } from 'commander';
import type { VaultAddOutput } from '../daemon/actions/vault-add.js';
import type { VaultEditOutput } from '../daemon/actions/vault-edit.js';
import type { VaultFilesOutput } from '../daemon/actions/vault-files.js';
import type { VaultListOutput } from '../daemon/actions/vault-list.js';
import type { VaultReadOutput } from '../daemon/actions/vault-read.js';
import type { VaultReindexOutput } from '../daemon/actions/vault-reindex.js';
import type { VaultRemoveOutput } from '../daemon/actions/vault-remove.js';
import type { VaultSearchOutput } from '../daemon/actions/vault-search.js';
import { invokeAction } from '../utils/action-client.js';
import { ensureDaemon } from '../utils/ensure-daemon.js';

export const registerVaults = (program: Command): void => {
  const cmd = program.command('vault').description('Manage vaults');

  cmd
    .command('list', { isDefault: true })
    .description('List registered vaults')
    .option('--json', 'JSON output')
    .action(async (opts: { json?: boolean }) => {
      await handleList(opts.json ?? false);
    });

  cmd
    .command('add <path>')
    .description('Register a vault and run the initial index scan')
    .option('--slug <slug>', 'Override the auto-derived slug')
    .option('--scope <scope>', 'local or shared', 'local')
    .option('--write-mode <mode>', 'inbox-dated or append-daily', 'inbox-dated')
    .action(async (path: string, opts: { slug?: string; scope?: string; writeMode?: string }) => {
      await handleAdd(path, opts);
    });

  cmd
    .command('remove <slug>')
    .description('Unregister a vault and delete its index (does not touch user files)')
    .action(async (slug: string) => {
      await handleRemove(slug);
    });

  cmd
    .command('reindex <slug>')
    .description('Force a full filesystem rescan of the vault')
    .action(async (slug: string) => {
      await handleReindex(slug);
    });

  cmd
    .command('files <slug>')
    .description('List files in a vault')
    .option('--prefix <prefix>', 'Filter by path prefix (e.g. inbox/)')
    .option('--limit <n>', 'Max results', '100')
    .option('--json', 'JSON output')
    .action(async (slug: string, opts: { prefix?: string; limit?: string; json?: boolean }) => {
      await handleFiles(slug, opts);
    });

  cmd
    .command('read <slug> <path>')
    .description('Print the content of a vault-relative file')
    .action(async (slug: string, path: string) => {
      await handleRead(slug, path);
    });

  cmd
    .command('search <slug> <query...>')
    .description('Full-text search the vault index (FTS5)')
    .option('--limit <n>', 'Max hits', '20')
    .option('--json', 'JSON output')
    .action(
      async (slug: string, queryParts: string[], opts: { limit?: string; json?: boolean }) => {
        await handleSearch(slug, queryParts.join(' '), opts);
      }
    );

  cmd
    .command('edit <slug>')
    .description('Write content to a vault (default: new file in inbox/)')
    .option('--content <text>', 'Content to write (otherwise reads stdin)')
    .option('--mode <mode>', 'inbox-dated, append-daily, or overwrite')
    .option('--path <path>', 'Vault-relative path (required for overwrite)')
    .action(async (slug: string, opts: { content?: string; mode?: string; path?: string }) => {
      await handleEdit(slug, opts);
    });
};

const handleList = async (jsonMode: boolean): Promise<void> => {
  await ensureDaemon();
  const result = await invokeAction<VaultListOutput>('vault:list', {}, ['vault.read']);
  if (jsonMode) {
    console.log(JSON.stringify(result.vaults, null, 2));
    process.exit(0);
    return;
  }
  if (result.vaults.length === 0) {
    console.log(chalk.gray('No vaults registered.'));
    console.log(chalk.dim('Run `agentage vault add <path>` to register one.'));
    process.exit(0);
    return;
  }
  const slugWidth = Math.max(8, ...result.vaults.map((v) => v.slug.length)) + 2;
  const pathWidth = Math.max(12, ...result.vaults.map((v) => v.path.length)) + 2;
  console.log(
    chalk.bold('SLUG'.padEnd(slugWidth)) +
      chalk.bold('PATH'.padEnd(pathWidth)) +
      chalk.bold('FILES'.padEnd(8)) +
      chalk.bold('INDEXED')
  );
  for (const v of result.vaults) {
    console.log(
      v.slug.padEnd(slugWidth) +
        chalk.gray(v.path.padEnd(pathWidth)) +
        String(v.fileCount).padEnd(8) +
        chalk.dim(v.indexedAt ?? 'never')
    );
  }
  console.log(chalk.dim(`\n${result.vaults.length} vault(s)`));
  process.exit(0);
};

const handleAdd = async (
  path: string,
  opts: { slug?: string; scope?: string; writeMode?: string }
): Promise<void> => {
  await ensureDaemon();
  const absPath = resolve(path);
  const input: Record<string, unknown> = { path: absPath };
  if (opts.slug) input['slug'] = opts.slug;
  if (opts.scope && opts.scope !== 'local') input['scope'] = opts.scope;
  if (opts.writeMode && opts.writeMode !== 'inbox-dated') input['writeMode'] = opts.writeMode;
  try {
    const result = await invokeAction<VaultAddOutput>('vault:add', input, ['vault.admin']);
    console.log(
      chalk.green(`Added vault "${result.slug}"`) +
        chalk.dim(` (${result.fileCount} files indexed)`)
    );
    console.log(chalk.dim(`  uuid: ${result.uuid}`));
    console.log(chalk.dim(`  path: ${result.path}`));
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red(`Failed to add vault: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
};

const handleRemove = async (slug: string): Promise<void> => {
  await ensureDaemon();
  try {
    await invokeAction<VaultRemoveOutput>('vault:remove', { slug }, ['vault.admin']);
    console.log(chalk.green(`Removed vault "${slug}"`));
    console.log(chalk.dim('  (your files on disk were not touched)'));
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red(`Failed to remove vault: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
};

const handleReindex = async (slug: string): Promise<void> => {
  await ensureDaemon();
  try {
    const result = await invokeAction<VaultReindexOutput>('vault:reindex', { slug }, [
      'vault.admin',
    ]);
    console.log(chalk.green(`Reindexed vault "${slug}"`));
    console.log(
      chalk.dim(
        `  added=${result.added} modified=${result.modified} removed=${result.removed} unchanged=${result.unchanged}`
      )
    );
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red(`Failed to reindex vault: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
};

const handleFiles = async (
  slug: string,
  opts: { prefix?: string; limit?: string; json?: boolean }
): Promise<void> => {
  await ensureDaemon();
  const input: Record<string, unknown> = { slug };
  if (opts.prefix) input['prefix'] = opts.prefix;
  if (opts.limit) input['limit'] = parseInt(opts.limit, 10);
  try {
    const result = await invokeAction<VaultFilesOutput>('vault:files', input, ['vault.read']);
    if (opts.json) {
      console.log(JSON.stringify(result.files, null, 2));
      process.exit(0);
      return;
    }
    if (result.files.length === 0) {
      console.log(chalk.gray('No files.'));
      process.exit(0);
      return;
    }
    const pathWidth = Math.max(8, ...result.files.map((f) => f.path.length)) + 2;
    console.log(
      chalk.bold('PATH'.padEnd(pathWidth)) + chalk.bold('SIZE'.padEnd(10)) + chalk.bold('MTIME')
    );
    for (const f of result.files) {
      console.log(
        f.path.padEnd(pathWidth) +
          chalk.dim(String(f.size).padEnd(10)) +
          chalk.dim(new Date(f.mtime).toISOString())
      );
    }
    console.log(chalk.dim(`\n${result.files.length} file(s)`));
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red(`Failed to list files: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
};

const handleRead = async (slug: string, path: string): Promise<void> => {
  await ensureDaemon();
  try {
    const result = await invokeAction<VaultReadOutput>('vault:read', { slug, path }, [
      'vault.read',
    ]);
    process.stdout.write(result.content);
    if (!result.content.endsWith('\n')) process.stdout.write('\n');
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`Failed to read: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
};

const handleSearch = async (
  slug: string,
  query: string,
  opts: { limit?: string; json?: boolean }
): Promise<void> => {
  await ensureDaemon();
  const input: Record<string, unknown> = { slug, query };
  if (opts.limit) input['limit'] = parseInt(opts.limit, 10);
  try {
    const result = await invokeAction<VaultSearchOutput>('vault:search', input, ['vault.read']);
    if (opts.json) {
      console.log(JSON.stringify(result.hits, null, 2));
      process.exit(0);
      return;
    }
    if (result.hits.length === 0) {
      console.log(chalk.gray(`No matches for "${query}".`));
      process.exit(0);
      return;
    }
    for (const hit of result.hits) {
      console.log(chalk.bold(hit.path) + chalk.dim(`  (score ${hit.score.toFixed(3)})`));
      console.log('  ' + hit.snippet.replace(/\n/g, ' '));
      console.log();
    }
    console.log(chalk.dim(`${result.hits.length} hit(s)`));
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red(`Failed to search: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
};

const handleEdit = async (
  slug: string,
  opts: { content?: string; mode?: string; path?: string }
): Promise<void> => {
  await ensureDaemon();
  let content = opts.content;
  if (content === undefined) {
    if (process.stdin.isTTY) {
      console.error(chalk.red('No content: pass --content "..." or pipe text to stdin'));
      process.exit(1);
      return;
    }
    content = await readStdin();
  }
  const input: Record<string, unknown> = { slug, content };
  if (opts.mode) input['mode'] = opts.mode;
  if (opts.path) input['path'] = opts.path;
  try {
    const result = await invokeAction<VaultEditOutput>('vault:edit', input, ['vault.write']);
    console.log(
      chalk.green(`Wrote ${result.bytesWritten} bytes`) +
        chalk.dim(` to ${result.path} (mode=${result.mode})`)
    );
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`Failed to edit: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
};
