import { describe, expect, it } from 'vitest';
import { pkg } from '../../test/config-dir.js';
import {
  integrityDrift,
  lockAgrees,
  lockEntries,
  parseLock,
  rootDependencies,
} from './compare-lock.js';

const [HELLO, WORLD] = [pkg('hello'), pkg('world')];

const entry = (version: string, integrity: string, resolved = 'http://127.0.0.1:4873/x.tgz') => ({
  version,
  resolved,
  integrity,
  license: 'MIT',
});

const lock = {
  name: 'agentage-extensions',
  lockfileVersion: 3,
  packages: {
    '': { name: 'agentage-extensions', dependencies: { [HELLO]: '^1.0.0', [WORLD]: '^1' } },
    [`node_modules/${HELLO}`]: entry('1.0.0', 'sha512-h'),
    [`node_modules/${WORLD}`]: entry('1.0.0', 'sha512-w'),
  },
};

const withHello = (helloEntry: object) => ({
  ...lock,
  packages: { ...lock.packages, [`node_modules/${HELLO}`]: helloEntry },
});

describe('the lock npm writes', () => {
  it('names a tree by each package, version and integrity, sorted', () => {
    expect(lockEntries(lock)).toEqual([`${HELLO}@1.0.0+sha512-h`, `${WORLD}@1.0.0+sha512-w`]);
  });

  it('names the same tree from another registry, npm version, key order or nesting', () => {
    const elsewhere = {
      lockfileVersion: 3,
      packages: {
        [`node_modules/${WORLD}`]: {
          integrity: 'sha512-w',
          version: '1.0.0',
          resolved: 'https://b',
        },
        [`node_modules/${WORLD}/node_modules/${HELLO}`]: entry('1.0.0', 'sha512-h', 'https://b'),
        [`node_modules/${HELLO}`]: entry('1.0.0', 'sha512-h', 'https://b'),
        '': { dependencies: { [WORLD]: '^1', [HELLO]: '^1.0.0' } },
      },
    };
    expect(lockEntries(elsewhere)).toEqual(lockEntries(lock));
  });

  it('names another tree when a version or an integrity changes', () => {
    expect(lockEntries(withHello(entry('1.0.1', 'sha512-h')))).not.toEqual(lockEntries(lock));
    expect(lockEntries(withHello(entry('1.0.0', 'sha512-x')))).not.toEqual(lockEntries(lock));
  });

  it('keys an aliased package by its real name', () => {
    const aliased = {
      packages: { 'node_modules/alias': { name: '@agentage/real', version: '2.0.0' } },
    };
    expect(lockEntries(aliased)).toEqual(['@agentage/real@2.0.0+']);
  });

  it('is reused only when its root dependencies equal the profile extensions', () => {
    expect(lockAgrees(lock, { [WORLD]: '^1', [HELLO]: '^1.0.0' })).toBe(true);
    expect(lockAgrees(lock, { [HELLO]: '^1.0.0' })).toBe(false);
    expect(lockAgrees(lock, { [HELLO]: '^1.0.0', [WORLD]: '^2' })).toBe(false);
    expect(lockAgrees({ packages: { '': 'x' } }, { [HELLO]: '^1' })).toBe(false);
    expect(lockAgrees({}, {})).toBe(true);
  });

  it('records the ranges package.json asked for as its root dependencies', () => {
    expect(rootDependencies(lock)).toEqual({ [HELLO]: '^1.0.0', [WORLD]: '^1' });
    expect(rootDependencies({ packages: {} })).toEqual({});
  });

  it('has integrity drift where the same name@version carries another integrity', () => {
    expect(integrityDrift(lock, lock)).toEqual([]);
    expect(integrityDrift(lock, withHello(entry('1.0.0', 'sha512-x')))).toEqual([`${HELLO}@1.0.0`]);
    expect(integrityDrift(lock, withHello(entry('1.0.1', 'sha512-x')))).toEqual([]);
  });

  it('counts only as JSON with a packages map', () => {
    expect(parseLock(null)).toBeNull();
    expect(parseLock('{ nope')).toBeNull();
    expect(parseLock('{"lockfileVersion":1,"dependencies":{}}')).toBeNull();
    expect(parseLock(JSON.stringify(lock))).toEqual(lock);
  });
});
