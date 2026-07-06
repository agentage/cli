import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// The 6 memory verbs run entirely over @agentage/memory-core's local git backend (fs + git,
// zero network). Blackhole any egress via unroutable proxies to prove offline. @p0
const BLACKHOLE = 'http://127.0.0.1:1';
const OFFLINE = {
  http_proxy: BLACKHOLE,
  https_proxy: BLACKHOLE,
  HTTP_PROXY: BLACKHOLE,
  HTTPS_PROXY: BLACKHOLE,
};

interface TreeEntry {
  type: 'file' | 'folder';
  path: string;
  entries?: TreeEntry[];
}

const treeFiles = (entries: TreeEntry[]): string[] =>
  entries.flatMap((e) => (e.type === 'file' ? [e.path] : e.entries ? treeFiles(e.entries) : []));

test.describe('offline memory CRUD @p0', () => {
  test.beforeAll(() => assertCliBuilt());

  test('write -> search -> read -> edit -> list -> delete, no network', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      const vaultDir = join(m.configDir, 'main');
      const add = await m.exec(['vault', 'add', 'main', '--local', vaultDir]);
      expect(add.code, add.stderr).toBe(0);

      const write = await m.exec([
        'memory',
        'write',
        'notes/q.md',
        '--body',
        'the quokka is a marsupial',
      ]);
      expect(write.code, write.stderr).toBe(0);

      const search = await m.exec(['memory', 'search', 'quokka', '--json']);
      expect(search.code, search.stderr).toBe(0);
      expect(JSON.parse(search.stdout).results.map((r: { path: string }) => r.path)).toEqual([
        'notes/q.md',
      ]);

      const read = await m.exec(['memory', 'read', 'notes/q.md']);
      expect(read.stdout).toContain('marsupial');

      const edit = await m.exec([
        'memory',
        'edit',
        'notes/q.md',
        '--old',
        'quokka',
        '--new',
        'wombat',
      ]);
      expect(edit.code, edit.stderr).toBe(0);
      expect((await m.exec(['memory', 'read', 'notes/q.md'])).stdout).toContain('wombat');

      const list = await m.exec(['memory', 'list', '--json']);
      expect(treeFiles(JSON.parse(list.stdout).entries)).toEqual(['notes/q.md']);

      const del = await m.exec(['memory', 'delete', 'notes/q.md']);
      expect(del.code, del.stderr).toBe(0);
      const after = await m.exec(['memory', 'list', '--json']);
      expect(treeFiles(JSON.parse(after.stdout).entries)).toHaveLength(0);

      // git-backed store: the vault folder is a repo carrying a commit per mutation
      // (write + edit + delete = 3).
      const log = execFileSync('git', ['-C', vaultDir, 'log', '--oneline'], { encoding: 'utf-8' });
      expect(log.trim().split('\n').length).toBeGreaterThanOrEqual(3);
    } finally {
      m.cleanup();
    }
  });

  test('a duplicate str_replace target reports the canonical error', async () => {
    const m = createCliMachine(OFFLINE);
    try {
      await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      await m.exec(['memory', 'write', 'd.md', '--body', 'x x']);
      const res = await m.exec(['memory', 'edit', 'd.md', '--old', 'x', '--new', 'y']);
      expect(res.code).not.toBe(0);
      expect(res.stderr + res.stdout).toContain('Multiple occurrences');
    } finally {
      m.cleanup();
    }
  });
});
