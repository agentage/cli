import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryClient } from '../lib/memory-client.js';
import { translateEngineMessage } from '../lib/memory-client.js';
import { runDelete, runEdit, runList, runRead, runSearch, runWrite } from './memory.js';

const client = (): MemoryClient => ({
  search: vi.fn(async () => ({
    results: [{ path: 'a.md', title: 'A', snippet: 's', score: 2, updated: 'now' }],
  })),
  read: vi.fn(async () => ({
    path: 'a.md',
    title: 'A',
    frontmatter: {},
    body: 'hi',
    tags: [],
    updated: 'now',
    deleted: false,
  })),
  write: vi.fn(async () => ({ path: 'a.md', rev: 'sha', updated: 'now' })),
  edit: vi.fn(async () => ({ path: 'a.md', rev: 'sha', updated: 'now' })),
  list: vi.fn(async () => ({
    folder: '',
    entries: [
      {
        type: 'folder' as const,
        path: 'notes',
        files: 1,
        entries: [{ type: 'file' as const, path: 'notes/a.md', title: 'a', updated: 'now' }],
      },
    ],
    truncated: false,
    files: 1,
  })),
  delete: vi.fn(async () => ({ path: 'a.md', deleted: true })),
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

  it('search --json emits the SearchResult', async () => {
    const c = client();
    await runSearch('q', { json: true }, c);
    expect(JSON.parse(logs[0] ?? '{}').results[0].path).toBe('a.md');
  });

  it('read prints the body; --json emits the MemoryView', async () => {
    const c = client();
    await runRead('a.md', {}, c);
    expect(logs.join()).toContain('hi');
    logs.length = 0;
    await runRead('a.md', { json: true }, c);
    expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({ path: 'a.md', deleted: false });
  });

  it('write passes an inline --body and parsed --frontmatter', async () => {
    const c = client();
    await runWrite('a.md', { body: 'hello', frontmatter: '{"title":"T"}' }, c);
    expect(c.write).toHaveBeenCalledWith('a.md', 'hello', {
      vault: undefined,
      frontmatter: { title: 'T' },
    });
    expect(logs.join()).toContain('Wrote a.md');
  });

  it('edit maps --old/--new to a str_replace op', async () => {
    const c = client();
    await runEdit('a.md', { old: 'x', new: 'y' }, c);
    expect(c.edit).toHaveBeenCalledWith(
      'a.md',
      { mode: 'str_replace', old_str: 'x', new_str: 'y' },
      { vault: undefined }
    );
  });

  it('edit --append selects append mode', async () => {
    const c = client();
    await runEdit('a.md', { body: 'more', append: true }, c);
    expect(c.edit).toHaveBeenCalledWith(
      'a.md',
      { mode: 'append', body: 'more' },
      { vault: undefined }
    );
  });

  it('list flattens the tree to file paths; --json emits the tree', async () => {
    const c = client();
    await runList('notes', { vault: 'v' }, c);
    expect(c.list).toHaveBeenCalledWith('notes', { vault: 'v' });
    expect(logs.join()).toContain('notes/a.md');
    logs.length = 0;
    await runList(undefined, { json: true }, c);
    expect(JSON.parse(logs[0] ?? '{}').entries[0].type).toBe('folder');
  });

  it('delete calls through and reports git recovery', async () => {
    const c = client();
    await runDelete('a.md', {}, c);
    expect(c.delete).toHaveBeenCalledWith('a.md', { vault: undefined });
    expect(logs.join()).toContain('git history');
  });

  it('edit with no --old/--new/--body errors instead of a silent no-op', async () => {
    const c = client();
    await expect(runEdit('a.md', {}, c)).rejects.toThrow(
      'specify --old/--new for a replacement or --body to overwrite'
    );
    expect(c.edit).not.toHaveBeenCalled();
  });

  it('write rejects invalid --frontmatter JSON with a friendly hint', async () => {
    const c = client();
    await expect(runWrite('a.md', { body: 'x', frontmatter: '{bad' }, c)).rejects.toThrow(
      /--frontmatter must be a JSON object, e\.g\. '\{"tags":\["x"\]\}'/
    );
    expect(c.write).not.toHaveBeenCalled();
  });

  it('write rejects non-object --frontmatter JSON (array/scalar)', async () => {
    const c = client();
    await expect(runWrite('a.md', { body: 'x', frontmatter: '[1,2]' }, c)).rejects.toThrow(
      /must be a JSON object/
    );
    await expect(runWrite('a.md', { body: 'x', frontmatter: '42' }, c)).rejects.toThrow(
      /must be a JSON object/
    );
    expect(c.write).not.toHaveBeenCalled();
  });

  it('write with no --body on a TTY errors instead of blocking on stdin', async () => {
    const c = client();
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await expect(runWrite('a.md', {}, c)).rejects.toThrow(
        'provide --body, or pipe content on stdin'
      );
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
    expect(c.write).not.toHaveBeenCalled();
  });
});

describe('engine error translation', () => {
  it('rewrites the memory__list MCP vocabulary to a CLI command', () => {
    const engine =
      'Unknown vault "@nosuchvault". Use memory__list with no folder to see available vaults.';
    const out = translateEngineMessage(engine);
    expect(out).not.toContain('memory__list');
    expect(out).toContain('Run `agentage vault list` to see available vaults.');
    expect(out).toContain('Unknown vault "@nosuchvault".');
  });

  it('passes through messages with no known engine pattern unchanged', () => {
    expect(translateEngineMessage('not found: a.md')).toBe('not found: a.md');
  });
});
