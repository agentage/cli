import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryClient } from '../lib/memory-client.js';
import { runDelete, runEdit, runList, runRead, runSearch, runWrite } from './memory.js';

const client = (): MemoryClient => ({
  search: vi.fn(async () => ({ vault: 'v', results: [{ path: 'a.md', snippet: 's', score: -1 }] })),
  read: vi.fn(async () => ({
    vault: 'v',
    path: 'a.md',
    title: 'A',
    frontmatter: {},
    body: 'hi',
    tags: [],
    updated: 'now',
    size: 2,
    truncated: false,
  })),
  write: vi.fn(async () => ({ vault: 'v', path: 'a.md', bytesWritten: 5 })),
  edit: vi.fn(async () => ({ vault: 'v', path: 'a.md', bytesWritten: 3 })),
  list: vi.fn(async () => ({
    vault: 'v',
    folder: '',
    entries: [{ path: 'a.md', updated: 'now' }],
  })),
  delete: vi.fn(async () => ({ vault: 'v', path: 'a.md', trashedTo: '.trash/a.md' })),
});

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => void logs.push(String(m)));
});
afterEach(() => vi.restoreAllMocks());

describe('memory command wiring', () => {
  it('search maps --limit and prints hits', async () => {
    const c = client();
    await runSearch('quokka', { limit: '5' }, c);
    expect(c.search).toHaveBeenCalledWith('quokka', { vault: undefined, limit: 5 });
    expect(logs.join()).toContain('a.md');
  });

  it('search --json emits JSON', async () => {
    const c = client();
    await runSearch('q', { json: true }, c);
    expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({ vault: 'v' });
  });

  it('write passes an inline --body and parsed --frontmatter', async () => {
    const c = client();
    await runWrite('a.md', { body: 'hello', frontmatter: '{"title":"T"}' }, c);
    expect(c.write).toHaveBeenCalledWith('a.md', 'hello', {
      vault: undefined,
      frontmatter: { title: 'T' },
    });
  });

  it('edit maps --old/--new to a str_replace op', async () => {
    const c = client();
    await runEdit('a.md', { old: 'x', new: 'y' }, c);
    expect(c.edit).toHaveBeenCalledWith(
      'a.md',
      { oldStr: 'x', newStr: 'y', body: undefined, mode: 'replace' },
      { vault: undefined }
    );
  });

  it('edit --append selects append mode', async () => {
    const c = client();
    await runEdit('a.md', { body: 'more', append: true }, c);
    expect(c.edit).toHaveBeenCalledWith(
      'a.md',
      { oldStr: undefined, newStr: undefined, body: 'more', mode: 'append' },
      { vault: undefined }
    );
  });

  it('read warns when the output was truncated', async () => {
    const c = client();
    c.read = vi.fn(async () => ({
      vault: 'v',
      path: 'a.md',
      title: 'A',
      frontmatter: {},
      body: 'big',
      tags: [],
      updated: 'now',
      size: 3,
      truncated: true,
    }));
    await runRead('a.md', {}, c);
    expect(logs.join()).toContain('truncated');
  });

  it('list and delete call through to the client', async () => {
    const c = client();
    await runList('notes', { vault: 'v' }, c);
    expect(c.list).toHaveBeenCalledWith('notes', { vault: 'v' });
    await runDelete('a.md', {}, c);
    expect(c.delete).toHaveBeenCalledWith('a.md', { vault: undefined });
    expect(logs.join()).toContain('.trash/a.md');
  });
});
