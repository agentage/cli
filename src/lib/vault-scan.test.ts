import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex } from './vault-index.js';
import { reindexVault } from './vault-scan.js';

describe('reindexVault', () => {
  let dir: string;
  let vault: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-scan-'));
    vault = join(dir, 'vault');
    mkdirSync(vault, { recursive: true });
    db = join(dir, 'index.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = (rel: string, body: string): void => {
    const full = join(vault, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  const searchPaths = (query: string): string[] => {
    const idx = openIndex(db);
    const paths = idx.search(query).map((h) => h.path);
    idx.close();
    return paths;
  };

  it('builds an index that search can query, walking subfolders', async () => {
    put('a.md', 'alpha content');
    put('sub/b.md', 'beta content');
    const stats = await reindexVault(vault, db);
    expect(stats.added).toBe(2);
    expect(searchPaths('beta')).toEqual(['sub/b.md']);
  });

  it('drop the db + reindex = identical results (index is a pure cache)', async () => {
    put('a.md', 'findme unique');
    await reindexVault(vault, db);
    const first = searchPaths('findme');
    unlinkSync(db);
    await reindexVault(vault, db);
    expect(searchPaths('findme')).toEqual(first);
    expect(first).toEqual(['a.md']);
  });

  it('detects modified + removed on a second pass', async () => {
    put('a.md', 'one');
    put('b.md', 'two');
    await reindexVault(vault, db);
    writeFileSync(join(vault, 'a.md'), 'one changed');
    unlinkSync(join(vault, 'b.md'));
    const stats = await reindexVault(vault, db);
    expect(stats.modified).toBe(1);
    expect(stats.removed).toBe(1);
    expect(searchPaths('two')).toHaveLength(0);
  });

  it('leaves unchanged files untouched on a re-run', async () => {
    put('a.md', 'stable');
    await reindexVault(vault, db);
    const stats = await reindexVault(vault, db);
    expect(stats).toMatchObject({ added: 0, modified: 0, removed: 0, unchanged: 1 });
  });

  it('skips dot-dirs like .obsidian and .git', async () => {
    put('a.md', 'keep');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    writeFileSync(join(vault, '.obsidian', 'x.md'), 'ignore me');
    const stats = await reindexVault(vault, db);
    expect(stats.added).toBe(1);
  });
});
