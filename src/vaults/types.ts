export type VaultScope = 'local' | 'shared';
export type VaultWriteMode = 'inbox-dated' | 'append-daily';

export interface VaultConfig {
  uuid: string;
  path: string;
  scope: VaultScope;
  writeMode: VaultWriteMode;
}

export interface VaultMetadata {
  slug: string;
  uuid: string;
  path: string;
  fileCount: number;
  indexedAt: string | null;
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

export interface FileStat {
  exists: boolean;
  size?: number;
  mtime?: number;
  sha256?: string;
}

export interface Hit {
  path: string;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  prefix?: string;
}

export interface FileChange {
  path: string;
  content: string;
  sha256: string;
  size: number;
  mtime: number;
}

export interface DiskDiff {
  added: FileChange[];
  modified: FileChange[];
  removed: string[];
}

export interface VaultIndex {
  search(query: string, opts?: SearchOptions): Promise<Hit[]>;
  stat(path: string): Promise<FileStat>;
  list(opts?: ListOptions): Promise<FileEntry[]>;
  reconcile(diff: DiskDiff): Promise<void>;
  fileCount(): Promise<number>;
  indexedAt(): Promise<string | null>;
  close(): Promise<void>;
}
