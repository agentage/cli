import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CouchSyncState } from '@agentage/memory-core';
import { couchStateDir, createStatePersistence } from './state-store.js';

const sample: CouchSyncState = { cursor: '42', revs: { 'a.md': 'h:1,h:2' }, pending: ['b.md'] };

describe('createStatePersistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cstate-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a saved state and writes under couch-state/<vault>.json', async () => {
    const p = createStatePersistence(dir, 'acct');
    expect(await p.load()).toBeNull();
    await p.save(sample);
    expect(await p.load()).toEqual(sample);
    const raw = await readFile(join(couchStateDir(dir), 'acct.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(sample);
  });

  it('degrades a corrupt state file to a fresh (null) state instead of throwing', async () => {
    const p = createStatePersistence(dir, 'acct');
    await p.save(sample);
    writeFileSync(join(couchStateDir(dir), 'acct.json'), '{ not json');
    expect(await p.load()).toBeNull();
  });

  it('leaves no .tmp behind after an atomic save', async () => {
    const p = createStatePersistence(dir, 'acct');
    await p.save(sample);
    await expect(readFile(join(couchStateDir(dir), 'acct.json.tmp'), 'utf8')).rejects.toThrow();
  });
});
