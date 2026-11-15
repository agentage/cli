import { describe, expect } from 'vitest';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { MOVED_MARKER, moveOldLists } from './move.js';

// A cli 0.51.1 config folder: profile.json with hello and world (world off), a tree, a dev link.
const oldFolder = (dir: ConfigDir) => {
  dir.machine({ [pkg('probe')]: fixture('probe') });
  dir.profile({ extensions: { hello: '^1.0.0', world: '^1' }, off: ['world'] });
  dir.tree('hello', 'world');
};

describe('the one-time move of the old lists (D6)', () => {
  test('profile.json, its off list and machine.json dev become installation.json rows', async ({
    dir,
  }) => {
    oldFolder(dir);
    const run = await output(() => moveOldLists());
    expect(dir.json('installation.json')).toEqual({
      host: 'local',
      extensions: [
        { id: 'hello', version: '1.0.0' },
        { id: 'world', version: '1.0.0', enabled: false },
        { id: 'probe', source: fixture('probe') },
      ],
    });
    expect(run.stderr).toBe('moved 3 extensions into installation.json');
    expect(dir.exists(MOVED_MARKER)).toBe(true);
    expect(dir.exists('profile.json') && dir.exists('machine.json')).toBe(true);
  });

  test('runs once: after the marker a changed old list moves nothing', async ({ dir }) => {
    oldFolder(dir);
    await output(() => moveOldLists());
    const before = dir.file('installation.json');
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1', secret: '^1' } });
    expect((await output(() => moveOldLists())).stderr).toBe('');
    expect(dir.file('installation.json')).toBe(before);
  });

  test('a stop before the marker is safe: the rerun keeps the rows the daemon has', async ({
    dir,
  }) => {
    oldFolder(dir);
    dir.write('installation.json', {
      host: 'local',
      extensions: [{ id: 'hello', version: '1.2.0' }],
    });
    await output(() => moveOldLists());
    const rows = dir.json('installation.json')['extensions'] as { id: string; version?: string }[];
    expect(rows.find((row) => row.id === 'hello')).toEqual({ id: 'hello', version: '1.2.0' });
    expect(rows.map((row) => row.id).sort()).toEqual(['hello', 'probe', 'world']);
  });

  test('a new machine writes only the marker', async ({ dir }) => {
    await output(() => moveOldLists());
    expect(dir.exists('installation.json')).toBe(false);
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });
});
