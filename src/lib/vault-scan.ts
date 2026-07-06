import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expandHome, indexDbPath } from './vault-registry.js';
import {
  openIndex,
  type DiskDiff,
  type FileChange,
  type FileEntry,
  type VaultIndex,
} from './vault-index.js';

// Reconcile a vault's markdown tree against its index: walk the folder, diff by mtime/size
// then sha256, and apply added/modified/removed. Dot-dirs and node_modules are skipped.

export interface ReindexStats {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
}

const isMarkdown = (name: string): boolean => /\.md$/i.test(name);
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

interface WalkResult {
  unchanged: number;
  added: FileChange[];
  modified: FileChange[];
  seen: Set<string>;
}

const walkMarkdown = async (root: string, inIndex: Map<string, FileEntry>): Promise<WalkResult> => {
  const added: FileChange[] = [];
  const modified: FileChange[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  const queue = [root];

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile() || !isMarkdown(entry.name)) continue;

      const relPath = relative(root, full);
      seen.add(relPath);
      const st = await stat(full);
      const existing = inIndex.get(relPath);
      if (existing && existing.mtime === st.mtimeMs && existing.size === st.size) {
        unchanged++;
        continue;
      }
      const buf = await readFile(full);
      const change: FileChange = {
        path: relPath,
        content: buf.toString('utf-8'),
        sha256: sha256(buf),
        size: st.size,
        mtime: st.mtimeMs,
      };
      if (!existing) added.push(change);
      else if (existing.sha256 !== change.sha256) modified.push(change);
      else unchanged++;
    }
  }
  return { unchanged, added, modified, seen };
};

const buildDiff = (walk: WalkResult, inIndex: Map<string, FileEntry>): DiskDiff => {
  const removed = [...inIndex.keys()].filter((path) => !walk.seen.has(path));
  return { added: walk.added, modified: walk.modified, removed };
};

// Reconcile an already-open index against the markdown tree at vaultPath (no open/close).
// Lets a caller keep the index open to query right after refreshing it.
export const reconcileIndex = async (
  index: VaultIndex,
  vaultPath: string
): Promise<ReindexStats> => {
  const inIndex = new Map(index.list().map((e) => [e.path, e]));
  const walk = await walkMarkdown(expandHome(vaultPath), inIndex);
  const diff = buildDiff(walk, inIndex);
  index.reconcile(diff);
  return {
    added: diff.added.length,
    modified: diff.modified.length,
    removed: diff.removed.length,
    unchanged: walk.unchanged,
  };
};

// Open the index at dbPath, reconcile it against the markdown tree at vaultPath, close.
export const reindexVault = async (vaultPath: string, dbPath: string): Promise<ReindexStats> => {
  const index = openIndex(dbPath);
  try {
    return await reconcileIndex(index, vaultPath);
  } finally {
    index.close();
  }
};

// Resolve the index db path for a named vault (its markdown dir is `vaultPath`).
export const reindexNamedVault = (name: string, vaultPath: string): Promise<ReindexStats> =>
  reindexVault(vaultPath, indexDbPath(name));
