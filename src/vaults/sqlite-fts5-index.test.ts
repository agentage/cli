import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFts5Index } from './sqlite-fts5-index.js';
import type { DiskDiff } from './types.js';

describe('SqliteFts5Index', () => {
  let idx: SqliteFts5Index;

  beforeEach(() => {
    idx = new SqliteFts5Index(':memory:');
  });

  afterEach(async () => {
    await idx.close();
  });

  it('starts empty', async () => {
    expect(await idx.fileCount()).toBe(0);
    expect(await idx.indexedAt()).toBeNull();
    expect(await idx.list()).toEqual([]);
    expect(await idx.search('anything')).toEqual([]);
  });

  it('reconcile inserts files and indexes content', async () => {
    const diff: DiskDiff = {
      added: [
        {
          path: 'notes/alpha.md',
          content: 'the quick brown fox jumps over the lazy dog',
          sha256: 'a1',
          size: 43,
          mtime: 1000,
        },
        {
          path: 'notes/beta.md',
          content: 'a second file mentions tortoise and hare',
          sha256: 'b2',
          size: 40,
          mtime: 1001,
        },
      ],
      modified: [],
      removed: [],
    };
    await idx.reconcile(diff);
    expect(await idx.fileCount()).toBe(2);
    expect(await idx.indexedAt()).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const hits = await idx.search('fox');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('notes/alpha.md');
    expect(hits[0]?.snippet).toContain('<<fox>>');
  });

  it('modify replaces fts content', async () => {
    await idx.reconcile({
      added: [{ path: 'a.md', content: 'apples', sha256: 's1', size: 6, mtime: 1 }],
      modified: [],
      removed: [],
    });
    expect((await idx.search('apples')).length).toBe(1);
    expect((await idx.search('oranges')).length).toBe(0);

    await idx.reconcile({
      added: [],
      modified: [{ path: 'a.md', content: 'oranges', sha256: 's2', size: 7, mtime: 2 }],
      removed: [],
    });
    expect((await idx.search('apples')).length).toBe(0);
    expect((await idx.search('oranges')).length).toBe(1);
  });

  it('remove drops files from list and search', async () => {
    await idx.reconcile({
      added: [{ path: 'x.md', content: 'something', sha256: 's', size: 9, mtime: 1 }],
      modified: [],
      removed: [],
    });
    expect(await idx.fileCount()).toBe(1);
    await idx.reconcile({ added: [], modified: [], removed: ['x.md'] });
    expect(await idx.fileCount()).toBe(0);
    expect(await idx.list()).toEqual([]);
    expect(await idx.search('something')).toEqual([]);
  });

  it('stat returns metadata or absence', async () => {
    await idx.reconcile({
      added: [{ path: 'p.md', content: 'c', sha256: 'h', size: 1, mtime: 100 }],
      modified: [],
      removed: [],
    });
    expect(await idx.stat('p.md')).toEqual({
      exists: true,
      size: 1,
      mtime: 100,
      sha256: 'h',
    });
    expect(await idx.stat('missing.md')).toEqual({ exists: false });
  });

  it('list with prefix filters by path', async () => {
    await idx.reconcile({
      added: [
        { path: 'inbox/2026-04-25.md', content: 'a', sha256: '1', size: 1, mtime: 1 },
        { path: 'daily/2026-04-25.md', content: 'b', sha256: '2', size: 1, mtime: 1 },
        { path: 'inbox/2026-04-24.md', content: 'c', sha256: '3', size: 1, mtime: 1 },
      ],
      modified: [],
      removed: [],
    });
    const inbox = await idx.list({ prefix: 'inbox/' });
    expect(inbox.map((f) => f.path).sort()).toEqual(['inbox/2026-04-24.md', 'inbox/2026-04-25.md']);
  });

  it('search ranks repeated terms higher', async () => {
    await idx.reconcile({
      added: [
        { path: 'a.md', content: 'cat dog', sha256: '1', size: 7, mtime: 1 },
        { path: 'b.md', content: 'cat cat cat', sha256: '2', size: 11, mtime: 1 },
      ],
      modified: [],
      removed: [],
    });
    const hits = await idx.search('cat');
    expect(hits[0]?.path).toBe('b.md');
  });

  it('search with empty/whitespace query returns no hits', async () => {
    await idx.reconcile({
      added: [{ path: 'a.md', content: 'anything', sha256: '1', size: 8, mtime: 1 }],
      modified: [],
      removed: [],
    });
    expect(await idx.search('')).toEqual([]);
    expect(await idx.search('   ')).toEqual([]);
  });

  it('search escapes embedded quotes safely', async () => {
    await idx.reconcile({
      added: [{ path: 'a.md', content: 'she said "hello world"', sha256: '1', size: 22, mtime: 1 }],
      modified: [],
      removed: [],
    });
    expect(await idx.search('hello')).toHaveLength(1);
    expect(await idx.search('"hello"')).toHaveLength(1);
  });

  it('reconcile updates indexedAt timestamp on every call', async () => {
    expect(await idx.indexedAt()).toBeNull();
    await idx.reconcile({ added: [], modified: [], removed: [] });
    const first = await idx.indexedAt();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await new Promise((r) => setTimeout(r, 5));
    await idx.reconcile({ added: [], modified: [], removed: [] });
    const second = await idx.indexedAt();
    expect(second).not.toBe(first);
  });

  it('persists to disk and re-opens with the same data', async () => {
    const path = `/tmp/agentage-vault-test-${Date.now()}.db`;
    const writer = new SqliteFts5Index(path);
    await writer.reconcile({
      added: [{ path: 'a.md', content: 'persisted content', sha256: 'h', size: 17, mtime: 1 }],
      modified: [],
      removed: [],
    });
    await writer.close();

    const reader = new SqliteFts5Index(path);
    expect(await reader.fileCount()).toBe(1);
    expect((await reader.search('persisted')).length).toBe(1);
    await reader.close();
  });
});
