import { describe, expect } from 'vitest';
import { pkg, test } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { loadOrder } from './order.js';
import { scan, loadSet } from './scan.js';

describe('the order extensions load in', () => {
  test('puts each peer before what depends on it, whatever the profile order', async ({ dir }) => {
    dir.extension('third', '', { peerDependencies: { [pkg('world')]: '^1' } });
    dir.profile({ extensions: { world: '^1', hello: '^1.0.0' } });
    dir.tree('world', 'hello');
    const all = loadSet(scan(await loadMachine()));
    expect(loadOrder([...all].reverse()).map((ext) => ext.id)).toEqual(['hello', 'world', 'third']);
  });

  test("for a command, is the command's extension with its peers and nothing else", async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1', secret: '^1' } });
    dir.tree('hello', 'world', 'secret');
    const all = loadSet(scan(await loadMachine()));
    const world = all.filter((ext) => ext.id === 'world');
    expect(loadOrder(world, all).map((ext) => ext.id)).toEqual(['hello', 'world']);
  });
});
