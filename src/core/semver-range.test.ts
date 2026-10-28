import { describe, expect, it } from 'vitest';
import { isRange, parseVersion, satisfies } from './semver-range.js';

describe('semver-range', () => {
  it('parses full versions with prerelease and build, rejects partials', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
    expect(parseVersion('v1.2.3-beta.1+sha')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: 'beta.1',
    });
    expect(parseVersion('1.2')).toBeNull();
  });

  it.each([
    ['^1', '1.0.0', true],
    ['^1', '1.9.9', true],
    ['^1', '2.0.0', false],
    ['^1', '2.0.0-beta', false],
    ['^1.2', '1.1.9', false],
    ['^0.1', '0.1.5', true],
    ['^0.1', '0.2.0', false],
    ['^0.0.3', '0.0.3', true],
    ['^0.0.3', '0.0.4', false],
    ['^0.0', '0.0.9', true],
    ['^0.0', '0.1.0', false],
    ['^0', '0.9.0', true],
    ['^0.0.0', '0.0.1', false],
    ['~1.2.3', '1.2.9', true],
    ['~1.2.3', '1.3.0', false],
    ['~1', '1.9.0', true],
    ['~1.2', '1.2.0', true],
    ['1', '1.4.0', true],
    ['1.x', '2.0.0', false],
    ['1.2.x', '1.2.7', true],
    ['1.2.3', '1.2.3', true],
    ['=1.2.3', '1.2.4', false],
    ['*', '9.9.9', true],
    ['x', '0.0.1', true],
    ['>=1.2', '1.2.0', true],
    ['>=1.2', '1.1.9', false],
    ['>1.2.3', '1.2.4', true],
    ['>1.2.3', '1.2.3', false],
    ['>1', '1.9.9', false],
    ['>1', '2.0.0', true],
    ['<1.2', '1.1.9', true],
    ['<1.2', '1.2.0', false],
    ['<1.2.3', '1.2.3', false],
    ['<=1.2.3', '1.2.3', true],
    ['<=1.2', '1.2.9', true],
    ['<=1.2', '1.3.0', false],
    ['<=*', '5.0.0', true],
    ['>= 1.0.0 < 2', '1.5.0', true],
    ['>=1.0.0 <2', '2.0.0', false],
    ['^0.1 || ^1', '1.0.0', true],
    ['^0.1 || ^2', '1.0.0', false],
    ['^1.0.0-beta', '1.0.0-rc', true],
    ['^1.0.0-rc', '1.0.0-beta', false],
    ['=1.0.0-rc', '1.0.0-rc', true],
  ])('%s against %s is %s', (range, version, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it.each(['', ' ', 'latest', '1.2.3 - 2.0.0', '1.x.3', '1.2-beta', '>*', '<x', '^1 ||', 'a.b.c'])(
    'refuses %j as a range',
    (range) => {
      expect(isRange(range)).toBe(false);
      expect(satisfies('1.0.0', range)).toBe(false);
    }
  );

  it('never satisfies with an unparsable version', () => {
    expect(satisfies('1.0', '^1')).toBe(false);
  });
});
