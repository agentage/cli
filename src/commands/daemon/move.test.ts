import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { runDaemonStatus } from './daemon.js';
import { MOVE_REPORT, MOVED_MARKER, moveOldLists } from './move.js';

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
    expect((await output(() => moveOldLists())).stderr).not.toContain('move skipped');
    const rows = dir.json('installation.json')['extensions'] as { id: string; version?: string }[];
    expect(rows.find((row) => row.id === 'hello')).toEqual({ id: 'hello', version: '1.2.0' });
    expect(rows.map((row) => row.id).sort()).toEqual(['hello', 'probe', 'world']);
  });

  test('a value the daemon has wins over the profile one; the other profile values move', async ({
    dir,
  }) => {
    oldFolder(dir);
    const profile = dir.json('profile.json');
    dir.write('profile.json', { ...profile, config: { hello: { greeting: 'old', mode: 'a' } } });
    dir.write('settings.json', { hello: { greeting: 'new' }, world: { x: 1 } });
    await output(() => moveOldLists());
    expect(dir.json('settings.json')).toEqual({
      hello: { greeting: 'new', mode: 'a' },
      world: { x: 1 },
    });
  });

  test('two kit 0.12 folders with one id: both are skipped and listed, neither runs', async ({
    dir,
  }) => {
    const a = writeKitExtension(dir.at('dev/a'), 'twin', '0.1.0', '^0.12');
    const b = writeKitExtension(dir.at('dev/b'), 'twin', '0.1.0', '^0.12');
    const pkgB = '@agentage/extension-twin-b';
    const json = dir.json(join('dev/b', 'package.json'));
    dir.write(join('dev/b', 'package.json'), { ...json, name: pkgB });
    dir.machine({ '@agentage/extension-twin': a, [pkgB]: b });
    await output(() => moveOldLists());
    expect(dir.exists('installation.json')).toBe(false);
    const reasons = (dir.json(MOVE_REPORT)['skipped'] as { reason: string }[]).map((s) => s.reason);
    expect(reasons).toEqual([
      `duplicate id "twin" (also ${pkgB})`,
      'duplicate id "twin" (also @agentage/extension-twin)',
    ]);
  });

  test('a new machine writes only the marker', async ({ dir }) => {
    await output(() => moveOldLists());
    expect(dir.exists('installation.json')).toBe(false);
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });

  test('an invalid profile.json moves nothing and writes no marker; status says why', async ({
    dir,
  }) => {
    oldFolder(dir);
    dir.write('profile.json', { version: 1, extensions: { [pkg('hello')]: 'file:../x' } });
    const run = await output(() => moveOldLists());
    expect(run.stderr).toMatch(/^move: profile\.json is invalid .*nothing moved/);
    expect(dir.exists(MOVED_MARKER)).toBe(false);
    expect(dir.exists('installation.json')).toBe(false);
    const status = await output(() => runDaemonStatus(async () => ({ kind: 'none' })));
    expect(status.lines.some((l) => l.startsWith('move: profile.json is invalid'))).toBe(true);
    dir.profile({ extensions: { hello: '^1.0.0' } });
    await output(() => moveOldLists());
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });

  test('a dev folder that is gone is skipped and reported, never run', async ({ dir }) => {
    dir.machine({ [pkg('probe')]: '/nonexistent/extension-probe' });
    const run = await output(() => moveOldLists());
    expect(dir.exists('installation.json')).toBe(false);
    expect(dir.json(MOVE_REPORT)).toMatchObject({ skipped: [{ reason: 'folder missing' }] });
    expect(run.stderr).toContain('move skipped');
    expect(dir.exists(MOVED_MARKER)).toBe(true);
  });
});
