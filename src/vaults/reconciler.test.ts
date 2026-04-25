import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, unlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteFts5Index } from './sqlite-fts5-index.js';
import { reconcileVault } from './reconciler.js';

describe('reconcileVault', () => {
  let vault: string;
  let idx: SqliteFts5Index;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'agentage-vault-'));
    idx = new SqliteFts5Index(':memory:');
  });

  afterEach(async () => {
    await idx.close();
    await rm(vault, { recursive: true, force: true });
  });

  it('first scan adds every markdown file and ignores non-md', async () => {
    await writeFile(join(vault, 'a.md'), 'alpha');
    await writeFile(join(vault, 'b.md'), 'beta');
    await writeFile(join(vault, 'ignore.txt'), 'plain text');
    await mkdir(join(vault, 'sub'), { recursive: true });
    await writeFile(join(vault, 'sub', 'c.md'), 'gamma');

    const stats = await reconcileVault(vault, idx);
    expect(stats).toEqual({ added: 3, modified: 0, removed: 0, unchanged: 0 });
    expect(await idx.fileCount()).toBe(3);
    expect((await idx.search('alpha'))[0]?.path).toBe('a.md');
    expect((await idx.search('gamma'))[0]?.path).toBe('sub/c.md');
  });

  it('skips dotfiles and node_modules', async () => {
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    await writeFile(join(vault, '.obsidian', 'workspace.md'), 'should be ignored');
    await mkdir(join(vault, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(vault, 'node_modules', 'pkg', 'README.md'), 'should be ignored');
    await writeFile(join(vault, 'real.md'), 'visible');

    const stats = await reconcileVault(vault, idx);
    expect(stats.added).toBe(1);
    expect(await idx.fileCount()).toBe(1);
  });

  it('re-run with no changes returns all unchanged (no rehash)', async () => {
    await writeFile(join(vault, 'a.md'), 'one');
    await writeFile(join(vault, 'b.md'), 'two');
    await reconcileVault(vault, idx);

    const second = await reconcileVault(vault, idx);
    expect(second).toEqual({ added: 0, modified: 0, removed: 0, unchanged: 2 });
  });

  it('detects modified file when content changes', async () => {
    const file = join(vault, 'a.md');
    await writeFile(file, 'original');
    await reconcileVault(vault, idx);

    await writeFile(file, 'edited');
    await utimes(file, new Date(), new Date(Date.now() + 1000));
    const stats = await reconcileVault(vault, idx);
    expect(stats.modified).toBe(1);
    expect(stats.added).toBe(0);
    expect((await idx.search('edited'))[0]?.path).toBe('a.md');
    expect(await idx.search('original')).toEqual([]);
  });

  it('detects deleted file', async () => {
    await writeFile(join(vault, 'a.md'), 'temp');
    await writeFile(join(vault, 'b.md'), 'persist');
    await reconcileVault(vault, idx);

    await unlink(join(vault, 'a.md'));
    const stats = await reconcileVault(vault, idx);
    expect(stats).toEqual({ added: 0, modified: 0, removed: 1, unchanged: 1 });
    expect(await idx.fileCount()).toBe(1);
  });

  it('detects added file on subsequent scan', async () => {
    await writeFile(join(vault, 'old.md'), 'existing');
    await reconcileVault(vault, idx);

    await writeFile(join(vault, 'new.md'), 'added later');
    const stats = await reconcileVault(vault, idx);
    expect(stats.added).toBe(1);
    expect(stats.unchanged).toBe(1);
  });

  it('mixed changes: add + modify + remove in one scan', async () => {
    await writeFile(join(vault, 'keep.md'), 'unchanged');
    await writeFile(join(vault, 'edit.md'), 'before');
    await writeFile(join(vault, 'delete.md'), 'doomed');
    await reconcileVault(vault, idx);

    await unlink(join(vault, 'delete.md'));
    await writeFile(join(vault, 'edit.md'), 'after');
    await utimes(join(vault, 'edit.md'), new Date(), new Date(Date.now() + 1000));
    await writeFile(join(vault, 'fresh.md'), 'brand new');

    const stats = await reconcileVault(vault, idx);
    expect(stats).toEqual({ added: 1, modified: 1, removed: 1, unchanged: 1 });
  });

  it('handles missing vault dir gracefully (returns zero stats)', async () => {
    const stats = await reconcileVault('/nonexistent/path/that/never/exists', idx);
    expect(stats).toEqual({ added: 0, modified: 0, removed: 0, unchanged: 0 });
  });
});
