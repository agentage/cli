import * as kit from '@agentage/extension/host';
import { describe, expect } from 'vitest';
import { kitIdProblem } from '../../core/kit-id.js';
import { ensureConfigDir } from '../../lib/fs/config.js';
import { output, test, type ConfigDir } from '../../test/config-dir.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { MOVE_REPORT, MOVED_MARKER, moveOldLists } from './move.js';

const LONG = 'a'.repeat(33);

// A cli 0.51.1 machine.json with dev folders of these ids, in this order.
const devFolders = (dir: ConfigDir, ids: string[]) =>
  dir.machine(
    Object.fromEntries(
      ids.map((id) => [
        `@agentage/extension-${id}`,
        writeKitExtension(dir.at(`dev/${id}`), id, '0.1.0'),
      ])
    )
  );

const ids = (dir: ConfigDir) =>
  (dir.json('installation.json')['extensions'] as { id: string }[]).map((row) => row.id);

describe('the move never stops at one row (kit 0.14 refuses some ids)', () => {
  test("the kit's row check and the cli's id rule agree", async ({ dir }) => {
    for (const id of ['sync', LONG]) {
      expect(kitIdProblem(id)).not.toBeNull();
      const row = { id, source: dir.at(`dev/${id}`) };
      const add = kit.updateInstallation(ensureConfigDir(), (doc) => ({
        ...doc,
        extensions: [row],
      }));
      await expect(add).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  test('a reserved and a long id are skipped with the reason; the rows around them move', async ({
    dir,
  }) => {
    devFolders(dir, ['alpha', 'sync', LONG, 'omega']);
    const run = await output(() => moveOldLists());
    expect(ids(dir)).toEqual(['alpha', 'omega']);
    expect(dir.json(MOVE_REPORT)).toMatchObject({ moved: ['alpha', 'omega'] });
    expect(run.stderr.split('\n')).toEqual([
      'moved 2 extensions into installation.json',
      `move skipped ${dir.at('dev/sync')}: the id sync is a name the platform owns or not lowercase: the daemon takes no such row`,
      `move skipped ${dir.at(`dev/${LONG}`)}: the id ${LONG} is longer than 32 characters: the daemon takes no such row`,
    ]);
    expect(dir.exists(MOVED_MARKER)).toBe(true);
    const before = dir.file('installation.json');
    expect((await output(() => moveOldLists())).stderr).toBe('');
    expect(dir.file('installation.json')).toBe(before);
  });

  test("a row the kit's check throws for is skipped; the next rows still move", async ({ dir }) => {
    devFolders(dir, ['alpha', 'bad', 'omega']);
    const refuse: typeof kit.updateInstallation = (configDir, change, waitMs) =>
      kit.updateInstallation(
        configDir,
        (doc) => {
          const next = change(doc);
          if (next.extensions.some((row) => row.id === 'bad'))
            throw Object.assign(new Error('a row C3 refuses'), { code: 'VALIDATION_ERROR' });
          return next;
        },
        waitMs
      );
    const run = await output(() =>
      moveOldLists({ kit: async () => ({ ...kit, updateInstallation: refuse }) })
    );
    expect(ids(dir)).toEqual(['alpha', 'omega']);
    expect(run.stderr).toContain('move skipped bad: the daemon refuses the row (a row C3 refuses)');
    expect(dir.json(MOVE_REPORT)).toMatchObject({ moved: ['alpha', 'omega'] });
  });

  test('an installation.json that holds a refused row: the good rows still move', async ({
    dir,
  }) => {
    devFolders(dir, ['alpha', 'omega']);
    dir.write('installation.json', {
      host: 'local',
      extensions: [{ id: 'sync', version: '1.0.0' }],
    });
    const run = await output(() => moveOldLists());
    expect(run.stderr).toBe('moved 2 extensions into installation.json');
    expect(ids(dir)).toEqual(expect.arrayContaining(['alpha', 'omega']));
  });
});
