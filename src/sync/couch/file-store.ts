import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { type FileStore } from '@agentage/memory-core';

// The couch channel speaks vault-relative POSIX paths; on Windows the fs layer still uses `\`.
const toPosix = (p: string): string => (sep === '/' ? p : p.split(sep).join('/'));
const fromPosix = (p: string): string => (sep === '/' ? p : p.split('/').join(sep));

// Recursively collect *.md under root as vault-relative POSIX paths. Dot-directories are skipped -
// `.git` (the engine's own repo) must never enter the content-addressed model, and editor state
// like `.obsidian/` holds no synced notes; this mirrors memory-core's own local listing.
const walk = async (root: string, dir: string, acc: string[]): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(root, abs, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(toPosix(relative(root, abs)));
  }
};

// A FileStore rooted at one account vault's mirror dir: the seam CouchSync reads/writes through.
export const createFileStore = (root: string): FileStore => ({
  async listMarkdown() {
    if (!existsSync(root)) return [];
    const acc: string[] = [];
    await walk(root, root, acc);
    return acc.sort();
  },
  async read(path) {
    try {
      return await readFile(join(root, fromPosix(path)), 'utf8');
    } catch {
      return null; // gone from the file set
    }
  },
  async write(path, body) {
    const abs = join(root, fromPosix(path));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
  },
  async remove(path) {
    await rm(join(root, fromPosix(path)), { force: true });
  },
});
