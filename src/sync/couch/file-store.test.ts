import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileStore } from './file-store.js';

describe('createFileStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fstore-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists nested *.md as sorted POSIX relative paths, excluding dotfiles and non-md', async () => {
    await mkdir(join(root, 'notes', 'sub'), { recursive: true });
    await mkdir(join(root, '.git', 'objects'), { recursive: true });
    await mkdir(join(root, '.obsidian'), { recursive: true });
    await writeFile(join(root, 'top.md'), 'x');
    await writeFile(join(root, 'notes', 'sub', 'deep.md'), 'x');
    await writeFile(join(root, 'notes', 'not-markdown.txt'), 'x');
    await writeFile(join(root, '.git', 'objects', 'ignored.md'), 'x');
    await writeFile(join(root, '.obsidian', 'workspace.md'), 'x');

    const store = createFileStore(root);
    expect(await store.listMarkdown()).toEqual(['notes/sub/deep.md', 'top.md']);
  });

  it('returns [] for a missing root', async () => {
    expect(await createFileStore(join(root, 'nope')).listMarkdown()).toEqual([]);
  });

  it('write creates parent dirs; read returns content, null when absent', async () => {
    const store = createFileStore(root);
    expect(await store.read('a/b/c.md')).toBeNull();
    await store.write('a/b/c.md', 'hello');
    expect(await store.read('a/b/c.md')).toBe('hello');
    expect(await readFile(join(root, 'a', 'b', 'c.md'), 'utf8')).toBe('hello');
  });

  it('remove deletes the file and is a no-op when absent', async () => {
    const store = createFileStore(root);
    await store.write('gone.md', 'bye');
    await store.remove('gone.md');
    expect(await store.read('gone.md')).toBeNull();
    await expect(store.remove('never.md')).resolves.toBeUndefined();
  });
});
