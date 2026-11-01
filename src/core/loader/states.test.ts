import { describe, expect, it } from 'vitest';
import { pkg } from '../../test/config-dir.js';
import { type DiscoveredExtension } from './discover.js';
import { staticStates } from './states.js';

const [HELLO, WORLD] = [pkg('hello'), pkg('world')];

// What discovery reports for an extension in the tree, with a valid manifest unless overridden.
const found = (name: string, extra: Partial<DiscoveredExtension> = {}): DiscoveredExtension => ({
  pkg: name,
  source: 'tree',
  dir: `/tree/${name}`,
  version: '1.0.0',
  id: name.replace('@agentage/fixture-', ''),
  entry: `/tree/${name}/index.js`,
  commands: [],
  peers: [],
  optionalPeers: [],
  problem: null,
  missing: false,
  ...extra,
});

const world = (extra: Partial<DiscoveredExtension> = {}) =>
  found(WORLD, { peers: [HELLO], ...extra });

const statesOf = (extensions: DiscoveredExtension[], off: string[] = []) =>
  Object.fromEntries(staticStates(extensions, off));

describe('the state of each extension, known without running it', () => {
  it('is installed when its manifest is valid and its peers are installed', () => {
    expect(statesOf([found(HELLO), world()])).toEqual({
      [HELLO]: { state: 'installed', error: null },
      [WORLD]: { state: 'installed', error: null },
    });
  });

  it('is blocked when a peer is missing, naming the peer, and a blocked peer blocks in turn', () => {
    const third = found('@agentage/third', { peers: [WORLD] });
    const states = statesOf([found(HELLO, { missing: true }), world(), third]);
    expect(states).toEqual({
      [HELLO]: { state: 'missing', error: 'not installed in the current tree' },
      [WORLD]: { state: 'blocked', error: `peer ${HELLO} is missing` },
      '@agentage/third': { state: 'blocked', error: `peer ${WORLD} is blocked` },
    });
  });

  it('is blocked when a peer is not in the profile', () => {
    expect(statesOf([world()])[WORLD]).toEqual({
      state: 'blocked',
      error: `peer ${HELLO} is not in the profile`,
    });
  });

  it('is not blocked by an optional peer that is absent or off', () => {
    const optional = world({ optionalPeers: [HELLO] });
    expect(statesOf([optional])[WORLD]?.state).toBe('installed');
    expect(statesOf([found(HELLO), optional], [HELLO])[WORLD]?.state).toBe('installed');
  });

  it('is invalid for every member of a peer cycle, and blocked for what depends on one', () => {
    const a = found('a', { peers: ['b'] });
    const b = found('b', { peers: ['a'] });
    const c = found('c', { peers: ['a', HELLO] });
    expect(statesOf([a, b, c, found(HELLO)])).toMatchObject({
      a: { state: 'invalid', error: 'peer dependency cycle' },
      b: { state: 'invalid', error: 'peer dependency cycle' },
      c: { state: 'blocked', error: 'peer a is invalid' },
    });
  });

  it('is invalid over off: a bad manifest shows even on a machine that turned it off', () => {
    expect(statesOf([found(HELLO, { problem: 'x' })], [HELLO])[HELLO]).toEqual({
      state: 'invalid',
      error: 'x',
    });
  });

  it('is never off for a dev path, and a missing dev path names the path', () => {
    const dev = found(HELLO, { source: 'dev', dir: '/src/hello' });
    expect(statesOf([dev], [HELLO])[HELLO]?.state).toBe('installed');
    const gone = found(HELLO, { source: 'dev', dir: '/src/gone', missing: true });
    expect(statesOf([gone])[HELLO]?.error).toBe('no package.json at /src/gone');
  });
});
