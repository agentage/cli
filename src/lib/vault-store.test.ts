import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDoc, docExists, editDoc, readDoc, writeDoc } from './vault-store.js';

describe('vault store', () => {
  let vault: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'agentage-store-'));
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it('round-trips a plain body', async () => {
    await writeDoc(vault, 'a.md', 'hello world');
    const doc = await readDoc(vault, 'a.md');
    expect(doc.body).toBe('hello world');
    expect(doc.frontmatter).toEqual({});
  });

  it('writes + parses frontmatter, deriving title + tags', async () => {
    await writeDoc(vault, 'n.md', 'body text', { title: 'My Note', tags: ['x', 'y'] });
    const doc = await readDoc(vault, 'n.md');
    expect(doc.frontmatter).toMatchObject({ title: 'My Note', tags: ['x', 'y'] });
    expect(doc.body).toBe('body text');
    expect(doc.title).toBe('My Note');
    expect(doc.tags).toEqual(['x', 'y']);
  });

  it('falls back to the first heading, then the filename, for the title', async () => {
    await writeDoc(vault, 'h.md', '# Heading Title\n\nbody');
    expect((await readDoc(vault, 'h.md')).title).toBe('Heading Title');
    await writeDoc(vault, 'plain.md', 'no heading');
    expect((await readDoc(vault, 'plain.md')).title).toBe('plain');
  });

  it('edits via str_replace, preserving frontmatter', async () => {
    await writeDoc(vault, 'a.md', 'one two three', { title: 'T' });
    await editDoc(vault, { path: 'a.md', oldStr: 'two', newStr: 'TWO' });
    const doc = await readDoc(vault, 'a.md');
    expect(doc.body).toBe('one TWO three');
    expect(doc.frontmatter).toMatchObject({ title: 'T' });
  });

  it('soft-deletes into .trash/, keeping the file recoverable', async () => {
    await writeDoc(vault, 'sub/a.md', 'keep me');
    const { trashedTo } = await deleteDoc(vault, 'sub/a.md');
    expect(trashedTo).toBe('.trash/sub/a.md');
    expect(docExists(vault, 'sub/a.md')).toBe(false);
    expect(existsSync(join(vault, '.trash/sub/a.md'))).toBe(true);
  });

  it('refuses a path that escapes the vault root', async () => {
    await expect(readDoc(vault, '../escape.md')).rejects.toThrow(/escapes the vault root/);
  });

  it('errors reading a missing file', async () => {
    await expect(readDoc(vault, 'nope.md')).rejects.toThrow(/not found/);
  });
});
