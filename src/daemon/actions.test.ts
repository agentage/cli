import { describe, expect, it, vi } from 'vitest';
import { type MemoryClient } from '../lib/memory/memory-client.js';
import { dispatchMemory, isMemoryVerb, MEMORY_VERBS } from './actions.js';

const client = (): MemoryClient => ({
  search: vi.fn(async () => ({ results: [] })),
  read: vi.fn(async () => ({
    path: 'a.md',
    title: 'A',
    frontmatter: {},
    body: 'b',
    tags: [],
    updated: 'now',
    deleted: false,
  })),
  write: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  edit: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  list: vi.fn(async () => ({ folder: '', entries: [], truncated: false, files: 0 })),
  delete: vi.fn(async () => ({ path: 'a.md', deleted: true })),
});

describe('dispatchMemory', () => {
  it('recognises exactly the six frozen verbs', () => {
    expect([...MEMORY_VERBS]).toEqual(['search', 'read', 'write', 'edit', 'list', 'delete']);
    expect(isMemoryVerb('search')).toBe(true);
    expect(isMemoryVerb('reindex')).toBe(false);
  });

  it('routes each verb to the matching client call with unpacked args', async () => {
    const c = client();
    await dispatchMemory(c, 'search', { query: 'q', opts: { limit: 5 } });
    expect(c.search).toHaveBeenCalledWith('q', { limit: 5 });

    await dispatchMemory(c, 'read', { ref: 'a.md', opts: { vault: 'v' } });
    expect(c.read).toHaveBeenCalledWith('a.md', { vault: 'v' });

    await dispatchMemory(c, 'write', { ref: 'a.md', body: 'hi', opts: undefined });
    expect(c.write).toHaveBeenCalledWith('a.md', 'hi', undefined);

    await dispatchMemory(c, 'edit', { ref: 'a.md', op: { mode: 'append', body: 'x' } });
    expect(c.edit).toHaveBeenCalledWith('a.md', { mode: 'append', body: 'x' }, undefined);

    await dispatchMemory(c, 'list', { folder: 'notes' });
    expect(c.list).toHaveBeenCalledWith('notes', undefined);

    await dispatchMemory(c, 'delete', { ref: 'a.md' });
    expect(c.delete).toHaveBeenCalledWith('a.md', undefined);
  });

  it('defaults a missing body to an empty payload', async () => {
    const c = client();
    await dispatchMemory(c, 'list', undefined);
    expect(c.list).toHaveBeenCalledWith(undefined, undefined);
  });
});
