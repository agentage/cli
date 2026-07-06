import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// A per-vault SQLite FTS5 index (~/.agentage/index/<name>.db). The index is a rebuildable
// cache: the markdown files are canonical, this is derived and can be dropped + rebuilt.
// Ported from the archived v0.24 module to node:sqlite (native sqlite addons are forbidden).

const require = createRequire(import.meta.url);

export interface Hit {
  path: string;
  score: number;
  snippet: string;
}
export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}
export interface FileChange extends FileEntry {
  content: string;
}
export interface DiskDiff {
  added: FileChange[];
  modified: FileChange[];
  removed: string[];
}
export interface SearchOptions {
  limit?: number;
  offset?: number;
}
export interface ListOptions {
  prefix?: string;
  limit?: number;
  offset?: number;
}

// Minimal shape of the node:sqlite surface we use (avoids a hard type dep on the module).
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDb;
}

// Lazy: importing node:sqlite at module top would throw on Node versions where it is still
// flagged, breaking every command. cli.ts re-execs index commands with the flag when needed.
export const loadSqlite = (): SqliteModule | null => {
  try {
    return require('node:sqlite') as SqliteModule;
  } catch {
    return null;
  }
};

const requireSqlite = (): SqliteModule => {
  const mod = loadSqlite();
  if (!mod)
    throw new Error(
      'the vault index needs node:sqlite (Node >= 22.5 with --experimental-sqlite, or Node >= 23.4)'
    );
  return mod;
};

const SCHEMA_VERSION = 1;
const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  path UNINDEXED,
  content,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Quote each term so FTS5 treats punctuation as literal, not query syntax.
const sanitizeFtsQuery = (query: string): string | null => {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.length === 0 ? null : tokens.join(' ');
};

const transaction = (db: SqliteDb, fn: () => void): void => {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export interface VaultIndex {
  search(query: string, opts?: SearchOptions): Hit[];
  stat(path: string): FileEntry | null;
  list(opts?: ListOptions): FileEntry[];
  reconcile(diff: DiskDiff): void;
  fileCount(): number;
  indexedAt(): string | null;
  close(): void;
}

export const openIndex = (dbPath: string, now: () => Date = () => new Date()): VaultIndex => {
  const { DatabaseSync } = requireSqlite();
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  if (!db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version'))
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );

  return {
    search: (query, opts = {}) => {
      const sanitized = sanitizeFtsQuery(query);
      if (sanitized === null) return [];
      return db
        .prepare(
          `SELECT path, snippet(files_fts, 1, '<<', '>>', '...', 32) AS snippet, bm25(files_fts) AS score
           FROM files_fts WHERE files_fts MATCH ? ORDER BY score LIMIT ? OFFSET ?`
        )
        .all(sanitized, opts.limit ?? 20, opts.offset ?? 0) as Hit[];
    },
    stat: (path) =>
      (db.prepare('SELECT path, size, mtime, sha256 FROM files WHERE path = ?').get(path) as
        FileEntry | undefined) ?? null,
    list: (opts = {}) => {
      const limit = opts.limit ?? -1;
      const offset = opts.offset ?? 0;
      if (opts.prefix !== undefined)
        return db
          .prepare(
            'SELECT path, size, mtime, sha256 FROM files WHERE path LIKE ? ORDER BY path LIMIT ? OFFSET ?'
          )
          .all(`${opts.prefix}%`, limit, offset) as FileEntry[];
      return db
        .prepare('SELECT path, size, mtime, sha256 FROM files ORDER BY path LIMIT ? OFFSET ?')
        .all(limit, offset) as FileEntry[];
    },
    reconcile: (diff) => {
      const upsertFile = db.prepare(
        'INSERT OR REPLACE INTO files (path, size, mtime, sha256) VALUES (?, ?, ?, ?)'
      );
      const deleteFts = db.prepare('DELETE FROM files_fts WHERE path = ?');
      const insertFts = db.prepare('INSERT INTO files_fts (path, content) VALUES (?, ?)');
      const deleteFile = db.prepare('DELETE FROM files WHERE path = ?');
      const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      transaction(db, () => {
        for (const f of [...diff.added, ...diff.modified]) {
          upsertFile.run(f.path, f.size, f.mtime, f.sha256);
          deleteFts.run(f.path);
          insertFts.run(f.path, f.content);
        }
        for (const path of diff.removed) {
          deleteFile.run(path);
          deleteFts.run(path);
        }
        setMeta.run('indexed_at', now().toISOString());
      });
    },
    fileCount: () => (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n,
    indexedAt: () =>
      (
        db.prepare('SELECT value FROM meta WHERE key = ?').get('indexed_at') as
          { value: string } | undefined
      )?.value ?? null,
    close: () => db.close(),
  };
};
