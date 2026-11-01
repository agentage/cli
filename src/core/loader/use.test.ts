import { describe, expect } from 'vitest';
import { test, type ConfigDir } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { type DiscoveredExtension } from './discover.js';
import { scan, loadSet } from './scan.js';
import { createUse, facadeOf } from './use.js';

// hello's API as its register returned it: a method that needs `this`, and a plain value.
const helloApi = {
  name: 'hello',
  greet(this: { name: string }) {
    return `hello from ${this.name}`;
  },
};

const byId = (found: DiscoveredExtension[], id: string): DiscoveredExtension => {
  const ext = found.find((e) => e.id === id);
  if (!ext) throw new Error(`${id} was not discovered`);
  return ext;
};

// world peer-depends on hello, secret does not; hello is loaded with the API above.
const installed = async (dir: ConfigDir) => {
  dir.profile({ extensions: { hello: '^1.0.0', world: '^1', secret: '^1' } });
  dir.tree('hello', 'world', 'secret');
  const found = loadSet(scan(await loadMachine()));
  const loaded = new Map([['hello', { ext: byId(found, 'hello'), facade: facadeOf(helloApi) }]]);
  return { world: byId(found, 'world'), secret: byId(found, 'secret'), loaded };
};

describe('ctx.use()', () => {
  test('gives a peer a frozen facade whose functions are bound to what register returned', async ({
    dir,
  }) => {
    const { world, loaded } = await installed(dir);
    const hello = createUse(world, loaded)('hello');
    expect(Object.isFrozen(hello)).toBe(true);
    expect(hello).not.toBe(helloApi);
    const { greet } = hello;
    expect(greet?.()).toBe('hello from hello');
  });

  test('keeps only functions: other values register returned never cross', () => {
    expect(Object.keys(facadeOf(helloApi))).toEqual(['greet']);
    expect(facadeOf(undefined)).toEqual({});
  });

  test('throws for an extension that is not a peer; with optional: true it returns undefined', async ({
    dir,
  }) => {
    const { secret, world, loaded } = await installed(dir);
    expect(() => createUse(secret, loaded)('hello')).toThrow(
      'use("hello"): not a loaded peer of secret'
    );
    expect(createUse(secret, loaded)('hello', { optional: true })).toBeUndefined();
    expect(createUse(world, loaded)('nope', { optional: true })).toBeUndefined();
  });
});
