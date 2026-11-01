import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { collectTrees } from './tree.js';

describe('collecting old trees', () => {
  test("removes every tree but the one kept, and never a staging dir: another run's, or the next run's to clear", async ({
    dir,
  }) => {
    for (const name of ['aaaa', 'bbbb', 'cccc', '.staging-live'])
      dir.write(`extensions/trees/${name}/package.json`, '{}');
    collectTrees(dir.at('extensions'), 'bbbb');
    expect(dir.list('extensions/trees')).toEqual(['.staging-live', 'bbbb']);
  });

  test('on a machine with no trees yet does nothing', async ({ dir }) => {
    collectTrees(dir.at('extensions'), 'aaaa');
    expect(dir.exists('extensions')).toBe(false);
  });
});
