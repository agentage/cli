import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CouchStatePersistence, type CouchSyncState } from '@agentage/memory-core';

// The couch sync cursor + rev-cache + pending queue for one vault, at
// <configDir>/couch-state/<vault>.json. Load returns null on a missing OR unparseable file so a
// corrupt state degrades to a fresh from-scratch sync rather than crashing the daemon; save is
// atomic (temp + rename) so a crash mid-write never truncates it.
export const couchStateDir = (configDir: string): string => join(configDir, 'couch-state');

export const createStatePersistence = (configDir: string, vault: string): CouchStatePersistence => {
  const dir = couchStateDir(configDir);
  const path = join(dir, `${encodeURIComponent(vault)}.json`);
  return {
    async load(): Promise<CouchSyncState | null> {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as CouchSyncState;
      } catch {
        return null;
      }
    },
    async save(state: CouchSyncState): Promise<void> {
      mkdirSync(dir, { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state), 'utf8');
      await rename(tmp, path);
    },
  };
};
