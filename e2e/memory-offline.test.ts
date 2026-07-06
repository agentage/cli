import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine } from './helpers.js';

// The 6 memory verbs make zero network calls (DirectClient = fs + SQLite), so this is the
// full offline CRUD round trip against the built binary. @p0
test.describe('offline memory CRUD @p0', () => {
  test.beforeAll(() => assertCliBuilt());

  test('write -> search -> read -> edit -> list -> delete, no network', async () => {
    const m = createCliMachine();
    try {
      const add = await m.exec([
        'vault',
        'add',
        'main',
        '--local',
        '--path',
        `${m.configDir}/main`,
      ]);
      expect(add.code, add.stderr).toBe(0);

      const write = await m.exec([
        'memory',
        'write',
        '@main/notes/q.md',
        '--body',
        'the quokka is a marsupial',
      ]);
      expect(write.code, write.stderr).toBe(0);

      const search = await m.exec(['memory', 'search', 'quokka', '--json']);
      expect(search.code, search.stderr).toBe(0);
      expect(JSON.parse(search.stdout).results.map((r: { path: string }) => r.path)).toEqual([
        'notes/q.md',
      ]);

      const read = await m.exec(['memory', 'read', '@main/notes/q.md']);
      expect(read.stdout).toContain('marsupial');

      const edit = await m.exec([
        'memory',
        'edit',
        '@main/notes/q.md',
        '--old',
        'quokka',
        '--new',
        'wombat',
      ]);
      expect(edit.code, edit.stderr).toBe(0);
      expect((await m.exec(['memory', 'read', '@main/notes/q.md'])).stdout).toContain('wombat');

      const list = await m.exec(['memory', 'list', '--json']);
      expect(JSON.parse(list.stdout).entries.map((e: { path: string }) => e.path)).toEqual([
        'notes/q.md',
      ]);

      const del = await m.exec(['memory', 'delete', '@main/notes/q.md']);
      expect(del.code, del.stderr).toBe(0);
      expect(JSON.parse((await m.exec(['memory', 'list', '--json'])).stdout).entries).toHaveLength(
        0
      );
    } finally {
      m.cleanup();
    }
  });

  test('a duplicate str_replace target reports the canonical error', async () => {
    const m = createCliMachine();
    try {
      await m.exec(['vault', 'add', 'main', '--local', '--path', `${m.configDir}/main`]);
      await m.exec(['memory', 'write', '@main/d.md', '--body', 'x x']);
      const res = await m.exec(['memory', 'edit', '@main/d.md', '--old', 'x', '--new', 'y']);
      expect(res.code).not.toBe(0);
      expect(res.stderr + res.stdout).toContain('Multiple occurrences');
    } finally {
      m.cleanup();
    }
  });
});
