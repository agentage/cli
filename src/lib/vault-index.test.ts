import { describe, expect, it } from 'vitest';
import { openIndex, type FileChange } from './vault-index.js';

const change = (path: string, content: string): FileChange => ({
  path,
  content,
  sha256: `sha-${path}-${content.length}`,
  size: content.length,
  mtime: 1,
});

describe('vault index (node:sqlite FTS5)', () => {
  it('reconciles adds and searches by content', () => {
    const idx = openIndex(':memory:');
    idx.reconcile({
      added: [change('a.md', 'the quick brown fox'), change('b.md', 'lazy dog sleeps')],
      modified: [],
      removed: [],
    });
    expect(idx.fileCount()).toBe(2);
    const hits = idx.search('fox');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('a.md');
    expect(hits[0]?.snippet).toContain('fox');
    idx.close();
  });

  it('stat returns metadata or null', () => {
    const idx = openIndex(':memory:');
    idx.reconcile({ added: [change('a.md', 'hi')], modified: [], removed: [] });
    expect(idx.stat('a.md')).toMatchObject({ path: 'a.md', size: 2 });
    expect(idx.stat('missing.md')).toBeNull();
    idx.close();
  });

  it('list respects prefix + path order', () => {
    const idx = openIndex(':memory:');
    idx.reconcile({
      added: [change('notes/b.md', 'y'), change('notes/a.md', 'x'), change('other/c.md', 'z')],
      modified: [],
      removed: [],
    });
    expect(idx.list({ prefix: 'notes/' }).map((e) => e.path)).toEqual(['notes/a.md', 'notes/b.md']);
    expect(idx.list()).toHaveLength(3);
    idx.close();
  });

  it('modified replaces content; removed drops from search + files', () => {
    const idx = openIndex(':memory:');
    idx.reconcile({ added: [change('a.md', 'apple')], modified: [], removed: [] });
    idx.reconcile({ added: [], modified: [change('a.md', 'banana')], removed: [] });
    expect(idx.search('apple')).toHaveLength(0);
    expect(idx.search('banana')).toHaveLength(1);
    idx.reconcile({ added: [], modified: [], removed: ['a.md'] });
    expect(idx.fileCount()).toBe(0);
    expect(idx.search('banana')).toHaveLength(0);
    idx.close();
  });

  it('returns [] for an empty/whitespace query', () => {
    const idx = openIndex(':memory:');
    expect(idx.search('   ')).toEqual([]);
    idx.close();
  });

  it('treats punctuation as literal, not FTS syntax', () => {
    const idx = openIndex(':memory:');
    idx.reconcile({ added: [change('a.md', 'node:sqlite is great')], modified: [], removed: [] });
    expect(idx.search('node:sqlite')).toHaveLength(1);
    idx.close();
  });

  it('records indexedAt after reconcile', () => {
    const idx = openIndex(':memory:', () => new Date('2026-07-06T00:00:00Z'));
    expect(idx.indexedAt()).toBeNull();
    idx.reconcile({ added: [change('a.md', 'x')], modified: [], removed: [] });
    expect(idx.indexedAt()).toBe('2026-07-06T00:00:00.000Z');
    idx.close();
  });
});
