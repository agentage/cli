import { describe, expect, it } from 'vitest';
import { type DiscoveredModule } from './discover.js';
import { staticStates } from './states.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';

const mod = (pkg: string, extra: Partial<DiscoveredModule> = {}): DiscoveredModule => ({
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

const world = (extra: Partial<DiscoveredModule> = {}) => mod(WORLD, { peers: [HELLO], ...extra });

const statesOf = (modules: DiscoveredModule[], off: string[] = []) =>
  Object.fromEntries(staticStates(modules, off));

describe('staticStates (T15)', () => {
  it('installed when manifests are valid and peers are installed', () => {
    expect(statesOf([mod(HELLO), world()])).toEqual({
      [HELLO]: { state: 'installed', error: null },
      [WORLD]: { state: 'installed', error: null },
    });
  });

  it('a peer that is off blocks its dependent, naming the peer', () => {
    expect(statesOf([mod(HELLO), world()], [HELLO])).toEqual({
      [HELLO]: { state: 'off', error: null },
      [WORLD]: { state: 'blocked', error: `peer ${HELLO} is off` },
    });
  });

  it('an invalid or missing peer blocks; blocked propagates', () => {
    const third = mod('@agentage/fixture-third', { peers: [WORLD] });
    const invalid = statesOf([mod(HELLO, { problem: 'bad engine' }), world(), third]);
    expect(invalid[HELLO]).toEqual({ state: 'invalid', error: 'bad engine' });
    expect(invalid[WORLD]).toEqual({ state: 'blocked', error: `peer ${HELLO} is invalid` });
    expect(invalid['@agentage/fixture-third']?.error).toBe(`peer ${WORLD} is blocked`);
    const missing = statesOf([mod(HELLO, { missing: true }), world()]);
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
    expect(statesOf([mod(HELLO), optional], [HELLO])[WORLD]?.state).toBe('installed');
  });

  it('marks every member of a peer cycle invalid, dependents blocked', () => {
    const a = mod('a', { peers: ['b'] });
    const b = mod('b', { peers: ['a'] });
    const c = mod('c', { peers: ['a'] });
    expect(statesOf([a, b, c])).toEqual({
      a: { state: 'invalid', error: 'peer dependency cycle' },
      b: { state: 'invalid', error: 'peer dependency cycle' },
      c: { state: 'blocked', error: 'peer a is invalid' },
    });
  });

  it('a dev module is never off; a missing dev path names the path', () => {
    const dev = mod(HELLO, { source: 'dev', dir: '/src/hello' });
    expect(statesOf([dev], [HELLO])[HELLO]?.state).toBe('installed');
    const gone = mod(HELLO, { source: 'dev', dir: '/src/gone', missing: true });
    expect(statesOf([gone])[HELLO]?.error).toBe('no package.json at /src/gone');
  });

  it('an invalid manifest wins over off', () => {
    expect(statesOf([mod(HELLO, { problem: 'x' })], [HELLO])[HELLO]?.state).toBe('invalid');
  });

  it('shared peers are resolved once and reused', () => {
    const a = mod('a', { peers: [HELLO] });
    const b = mod('b', { peers: [HELLO, 'a'] });
    expect(statesOf([b, a, mod(HELLO)])['b']?.state).toBe('installed');
  });
});
