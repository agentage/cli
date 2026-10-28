import { describe, expect, it } from 'vitest';
import { type DiscoveredPlugin } from './discover.js';
import { staticStates } from './states.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';

const plugin = (pkg: string, extra: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({
  pkg,
  source: 'tree',
  dir: `/tree/${pkg}`,
  version: '1.0.0',
  id: pkg.replace('@agentage/fixture-', ''),
  entry: `/tree/${pkg}/index.js`,
  commands: [],
  peers: [],
  optionalPeers: [],
  problem: null,
  missing: false,
  ...extra,
});

const world = (extra: Partial<DiscoveredPlugin> = {}) =>
  plugin(WORLD, { peers: [HELLO], ...extra });

const statesOf = (plugins: DiscoveredPlugin[], off: string[] = []) =>
  Object.fromEntries(staticStates(plugins, off));

describe('staticStates (T15)', () => {
  it('installed when manifests are valid and peers are installed', () => {
    expect(statesOf([plugin(HELLO), world()])).toEqual({
      [HELLO]: { state: 'installed', error: null },
      [WORLD]: { state: 'installed', error: null },
    });
  });

  it('a peer that is off blocks its dependent, naming the peer', () => {
    expect(statesOf([plugin(HELLO), world()], [HELLO])).toEqual({
      [HELLO]: { state: 'off', error: null },
      [WORLD]: { state: 'blocked', error: `peer ${HELLO} is off` },
    });
  });

  it('an invalid or missing peer blocks; blocked propagates', () => {
    const third = plugin('@agentage/fixture-third', { peers: [WORLD] });
    const invalid = statesOf([plugin(HELLO, { problem: 'bad engine' }), world(), third]);
    expect(invalid[HELLO]).toEqual({ state: 'invalid', error: 'bad engine' });
    expect(invalid[WORLD]).toEqual({ state: 'blocked', error: `peer ${HELLO} is invalid` });
    expect(invalid['@agentage/fixture-third']?.error).toBe(`peer ${WORLD} is blocked`);
    const missing = statesOf([plugin(HELLO, { missing: true }), world()]);
    expect(missing[HELLO]).toEqual({
      state: 'missing',
      error: 'not installed in the current tree',
    });
    expect(missing[WORLD]?.error).toBe(`peer ${HELLO} is missing`);
  });

  it('a peer absent from the profile blocks', () => {
    expect(statesOf([world()])[WORLD]).toEqual({
      state: 'blocked',
      error: `peer ${HELLO} is not in the profile`,
    });
  });

  it('honours peerDependenciesMeta.optional', () => {
    const optional = world({ optionalPeers: [HELLO] });
    expect(statesOf([optional])[WORLD]?.state).toBe('installed');
    expect(statesOf([plugin(HELLO), optional], [HELLO])[WORLD]?.state).toBe('installed');
  });

  it('marks every member of a peer cycle invalid, dependents blocked', () => {
    const a = plugin('a', { peers: ['b'] });
    const b = plugin('b', { peers: ['a'] });
    const c = plugin('c', { peers: ['a'] });
    expect(statesOf([a, b, c])).toEqual({
      a: { state: 'invalid', error: 'peer dependency cycle' },
      b: { state: 'invalid', error: 'peer dependency cycle' },
      c: { state: 'blocked', error: 'peer a is invalid' },
    });
  });

  it('a dev plugin is never off; a missing dev path names the path', () => {
    const dev = plugin(HELLO, { source: 'dev', dir: '/src/hello' });
    expect(statesOf([dev], [HELLO])[HELLO]?.state).toBe('installed');
    const gone = plugin(HELLO, { source: 'dev', dir: '/src/gone', missing: true });
    expect(statesOf([gone])[HELLO]?.error).toBe('no package.json at /src/gone');
  });

  it('an invalid manifest wins over off', () => {
    expect(statesOf([plugin(HELLO, { problem: 'x' })], [HELLO])[HELLO]?.state).toBe('invalid');
  });

  it('shared peers are resolved once and reused', () => {
    const a = plugin('a', { peers: [HELLO] });
    const b = plugin('b', { peers: [HELLO, 'a'] });
    expect(statesOf([b, a, plugin(HELLO)])['b']?.state).toBe('installed');
  });
});
