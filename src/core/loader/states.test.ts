import { describe, expect, it } from 'vitest';
import { type DiscoveredExtension } from './discover.js';
import { staticStates } from './states.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';

const extension = (pkg: string, extra: Partial<DiscoveredExtension> = {}): DiscoveredExtension => ({
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

const world = (extra: Partial<DiscoveredExtension> = {}) =>
  extension(WORLD, { peers: [HELLO], ...extra });

const statesOf = (extensions: DiscoveredExtension[], off: string[] = []) =>
  Object.fromEntries(staticStates(extensions, off));

describe('staticStates (T15)', () => {
  it('installed when manifests are valid and peers are installed', () => {
    expect(statesOf([extension(HELLO), world()])).toEqual({
      [HELLO]: { state: 'installed', error: null },
      [WORLD]: { state: 'installed', error: null },
    });
  });

  it('a peer that is off blocks its dependent, naming the peer', () => {
    expect(statesOf([extension(HELLO), world()], [HELLO])).toEqual({
      [HELLO]: { state: 'off', error: null },
      [WORLD]: { state: 'blocked', error: `peer ${HELLO} is off` },
    });
  });

  it('an invalid or missing peer blocks; blocked propagates', () => {
    const third = extension('@agentage/fixture-third', { peers: [WORLD] });
    const invalid = statesOf([extension(HELLO, { problem: 'bad engine' }), world(), third]);
    expect(invalid[HELLO]).toEqual({ state: 'invalid', error: 'bad engine' });
    expect(invalid[WORLD]).toEqual({ state: 'blocked', error: `peer ${HELLO} is invalid` });
    expect(invalid['@agentage/fixture-third']?.error).toBe(`peer ${WORLD} is blocked`);
    const missing = statesOf([extension(HELLO, { missing: true }), world()]);
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
    expect(statesOf([extension(HELLO), optional], [HELLO])[WORLD]?.state).toBe('installed');
  });

  it('marks every member of a peer cycle invalid, dependents blocked', () => {
    const a = extension('a', { peers: ['b'] });
    const b = extension('b', { peers: ['a'] });
    const c = extension('c', { peers: ['a'] });
    expect(statesOf([a, b, c])).toEqual({
      a: { state: 'invalid', error: 'peer dependency cycle' },
      b: { state: 'invalid', error: 'peer dependency cycle' },
      c: { state: 'blocked', error: 'peer a is invalid' },
    });
  });

  it('a dev extension is never off; a missing dev path names the path', () => {
    const dev = extension(HELLO, { source: 'dev', dir: '/src/hello' });
    expect(statesOf([dev], [HELLO])[HELLO]?.state).toBe('installed');
    const gone = extension(HELLO, { source: 'dev', dir: '/src/gone', missing: true });
    expect(statesOf([gone])[HELLO]?.error).toBe('no package.json at /src/gone');
  });

  it('an invalid manifest wins over off', () => {
    expect(statesOf([extension(HELLO, { problem: 'x' })], [HELLO])[HELLO]?.state).toBe('invalid');
  });

  it('shared peers are resolved once and reused', () => {
    const a = extension('a', { peers: [HELLO] });
    const b = extension('b', { peers: [HELLO, 'a'] });
    expect(statesOf([b, a, extension(HELLO)])['b']?.state).toBe('installed');
  });
});
