import { describe, expect, it } from 'vitest';
import { equalLocks, lockAgrees, lockEntries, parseLock } from './compare-lock.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';

const pkg = (version: string, integrity: string, resolved = 'http://a/x.tgz') => ({
  version,
  resolved,
  integrity,
  license: 'MIT',
});

const lockA = {
  name: 'agentage-extensions',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'agentage-extensions', dependencies: { [HELLO]: '^1.0.0', [WORLD]: '^1' } },
    [`node_modules/${HELLO}`]: pkg('1.0.0', 'sha512-h'),
    [`node_modules/${WORLD}`]: pkg('1.0.0', 'sha512-w'),
  },
};

// Another npm major: other key order, other resolved host, a nested copy, no license.
const lockB = {
  lockfileVersion: 3,
  name: 'agentage-extensions',
  packages: {
    [`node_modules/${WORLD}`]: { integrity: 'sha512-w', version: '1.0.0', resolved: 'https://b' },
    [`node_modules/${WORLD}/node_modules/${HELLO}`]: pkg('1.0.0', 'sha512-h', 'https://b'),
    [`node_modules/${HELLO}`]: pkg('1.0.0', 'sha512-h', 'https://b'),
    '': { dependencies: { [WORLD]: '^1', [HELLO]: '^1.0.0' } },
  },
};

describe('compare-lock (D9)', () => {
  it('normalizes to a sorted set of name@version+integrity', () => {
    expect(lockEntries(lockA)).toEqual([`${HELLO}@1.0.0+sha512-h`, `${WORLD}@1.0.0+sha512-w`]);
  });

  it('ignores resolved, key order, formatting and nesting', () => {
    expect(equalLocks(lockA, lockB)).toBe(true);
  });

  it('differs on a version or an integrity change', () => {
    const bumped = {
      ...lockA,
      packages: { ...lockA.packages, [`node_modules/${HELLO}`]: pkg('1.0.1', 'sha512-h') },
    };
    const tampered = {
      ...lockA,
      packages: { ...lockA.packages, [`node_modules/${HELLO}`]: pkg('1.0.0', 'sha512-x') },
    };
    expect(equalLocks(lockA, bumped)).toBe(false);
    expect(equalLocks(lockA, tampered)).toBe(false);
    expect(equalLocks(lockA, { packages: {} })).toBe(false);
  });

  it('prefers an explicit name over the install path (aliases, links)', () => {
    const lock = {
      packages: { 'node_modules/alias': { name: '@agentage/real', version: '2.0.0' } },
    };
    expect(lockEntries(lock)).toEqual(['@agentage/real@2.0.0+']);
  });

  it('reads a document without a packages map as an empty set', () => {
    expect(lockEntries({})).toEqual([]);
    expect(lockAgrees({}, {})).toBe(true);
  });

  it('parses only JSON with a packages map', () => {
    expect(parseLock(null)).toBeNull();
    expect(parseLock('{ nope')).toBeNull();
    expect(parseLock('{"lockfileVersion":1,"dependencies":{}}')).toBeNull();
    expect(parseLock(JSON.stringify(lockA))).toEqual(lockA);
  });

  it('agrees only when the root dependencies equal package.json', () => {
    expect(lockAgrees(lockA, { [WORLD]: '^1', [HELLO]: '^1.0.0' })).toBe(true);
    expect(lockAgrees(lockA, { [HELLO]: '^1.0.0' })).toBe(false);
    expect(lockAgrees(lockA, { [HELLO]: '^1.0.0', [WORLD]: '^2' })).toBe(false);
    expect(lockAgrees({ packages: {} }, {})).toBe(true);
    expect(lockAgrees({ packages: { '': 'x' } }, { [HELLO]: '^1' })).toBe(false);
  });
});
