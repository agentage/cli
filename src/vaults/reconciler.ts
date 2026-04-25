import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FileChange, FileEntry, VaultIndex } from './types.js';

export interface ReconcileStats {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
}

const isMarkdown = (filename: string): boolean => /\.md$/i.test(filename);

const sha256OfBuffer = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

interface WalkResult {
  unchanged: number;
  added: FileChange[];
  modified: FileChange[];
  seen: Set<string>;
}

const walkMarkdownFiles = async (
  root: string,
  inIndexByPath: Map<string, FileEntry>
): Promise<WalkResult> => {
  const added: FileChange[] = [];
  const modified: FileChange[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile() || !isMarkdown(entry.name)) continue;

      const relPath = relative(root, full);
      seen.add(relPath);
      const st = await stat(full);
      const existing = inIndexByPath.get(relPath);

      if (existing && existing.mtime === st.mtimeMs && existing.size === st.size) {
        unchanged++;
        continue;
      }

      const buf = await readFile(full);
      const sha256 = sha256OfBuffer(buf);
      const change: FileChange = {
        path: relPath,
        content: buf.toString('utf-8'),
        sha256,
        size: st.size,
        mtime: st.mtimeMs,
      };

      if (!existing) {
        added.push(change);
      } else if (existing.sha256 !== sha256) {
        modified.push(change);
      } else {
        unchanged++;
      }
    }
  }
  return { unchanged, added, modified, seen };
};

export const reconcileVault = async (
  vaultPath: string,
  index: VaultIndex
): Promise<ReconcileStats> => {
  const inIndex = await index.list();
  const inIndexByPath = new Map(inIndex.map((e) => [e.path, e]));

  const { unchanged, added, modified, seen } = await walkMarkdownFiles(vaultPath, inIndexByPath);

  const removed: string[] = [];
  for (const path of inIndexByPath.keys()) {
    if (!seen.has(path)) removed.push(path);
  }

  await index.reconcile({ added, modified, removed });

  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    unchanged,
  };
};
