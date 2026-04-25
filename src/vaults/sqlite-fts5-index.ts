import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import type {
  VaultIndex,
  Hit,
  FileStat,
  FileEntry,
  SearchOptions,
  ListOptions,
  DiskDiff,
} from './types.js';

const SCHEMA_VERSION = 1;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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

export class SqliteFts5Index implements VaultIndex {
  private db: DB;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.initMeta();
  }

  private initMeta(): void {
    const existing = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (!existing) {
      this.db
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(SCHEMA_VERSION));
    }
  }

  async search(query: string, opts: SearchOptions = {}): Promise<Hit[]> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sanitized = sanitizeFtsQuery(query);
    if (sanitized === null) return [];
    const rows = this.db
      .prepare(
        `SELECT path,
                snippet(files_fts, 1, '<<', '>>', '...', 32) AS snippet,
                bm25(files_fts) AS score
         FROM files_fts
         WHERE files_fts MATCH ?
         ORDER BY score
         LIMIT ? OFFSET ?`
      )
      .all(sanitized, limit, offset) as Array<{ path: string; snippet: string; score: number }>;
    return rows.map((r) => ({ path: r.path, score: r.score, snippet: r.snippet }));
  }

  async stat(path: string): Promise<FileStat> {
    const row = this.db
      .prepare('SELECT size, mtime, sha256 FROM files WHERE path = ?')
      .get(path) as { size: number; mtime: number; sha256: string } | undefined;
    if (!row) return { exists: false };
    return { exists: true, size: row.size, mtime: row.mtime, sha256: row.sha256 };
  }

  async list(opts: ListOptions = {}): Promise<FileEntry[]> {
    const limit = opts.limit ?? -1;
    const offset = opts.offset ?? 0;
    if (opts.prefix !== undefined) {
      return this.db
        .prepare(
          `SELECT path, size, mtime, sha256 FROM files
           WHERE path LIKE ? ORDER BY path LIMIT ? OFFSET ?`
        )
        .all(`${opts.prefix}%`, limit, offset) as FileEntry[];
    }
    return this.db
      .prepare(
        `SELECT path, size, mtime, sha256 FROM files
         ORDER BY path LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as FileEntry[];
  }

  async reconcile(diff: DiskDiff): Promise<void> {
    const upsertFile = this.db.prepare(
      'INSERT OR REPLACE INTO files (path, size, mtime, sha256) VALUES (?, ?, ?, ?)'
    );
    const deleteFts = this.db.prepare('DELETE FROM files_fts WHERE path = ?');
    const insertFts = this.db.prepare('INSERT INTO files_fts (path, content) VALUES (?, ?)');
    const deleteFile = this.db.prepare('DELETE FROM files WHERE path = ?');
    const upsertMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

    const apply = this.db.transaction(() => {
      for (const f of diff.added) {
        upsertFile.run(f.path, f.size, f.mtime, f.sha256);
        deleteFts.run(f.path);
        insertFts.run(f.path, f.content);
      }
      for (const f of diff.modified) {
        upsertFile.run(f.path, f.size, f.mtime, f.sha256);
        deleteFts.run(f.path);
        insertFts.run(f.path, f.content);
      }
      for (const path of diff.removed) {
        deleteFile.run(path);
        deleteFts.run(path);
      }
      upsertMeta.run('indexed_at', new Date().toISOString());
    });

    apply();
  }

  async fileCount(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number };
    return row.n;
  }

  async indexedAt(): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('indexed_at') as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

const sanitizeFtsQuery = (query: string): string | null => {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (tokens.length === 0) return null;
  return tokens.join(' ');
};
