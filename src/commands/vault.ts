import { resolve } from 'node:path';
import chalk from 'chalk';
import { type Command } from 'commander';
import type { VaultAddOutput } from '../daemon/actions/vault-add.js';
import type { VaultListOutput } from '../daemon/actions/vault-list.js';
import type { VaultReindexOutput } from '../daemon/actions/vault-reindex.js';
import type { VaultRemoveOutput } from '../daemon/actions/vault-remove.js';
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
