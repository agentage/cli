import { validateManifest } from '@agentage/extension/tool';
import { describe, expect, it } from 'vitest';
import { dateVersion, dayOf, lastTag, tagOf, versionOfTag } from './release-date.js';

// The kit's own version check: what readManifest accepts in package.json.
const valid = (version: string): boolean => {
  const pkg = { name: '@agentage/extension-probe', version, engines: { agentage: '^0.5' } };
  try {
    validateManifest({ ...pkg, agentage: { id: 'probe', parts: { pages: true } } });
    return true;
  } catch {
    return false;
  }
};

describe('the date version YYYY.MDD.N', () => {
  it.each([
    ['2027-01-05T00:00:00Z', '2027.105.1'],
    ['2026-03-09T12:00:00Z', '2026.309.1'],
    ['2026-11-22T10:00:00Z', '2026.1122.1'],
    ['2026-12-31T23:59:59Z', '2026.1231.1'],
    ['2026-01-01T00:00:00Z', '2026.101.1'],
  ])('%s is %s, valid semver with no leading zero', (at, version) => {
    expect(dateVersion('probe', [], new Date(at))).toBe(version);
    expect(valid(version)).toBe(true);
  });

  it('the day is the UTC day, not the local one', () => {
    expect(dayOf(new Date('2026-11-22T23:30:00-05:00'))).toBe('2026.1123');
  });

  it('the second release of a day is N + 1 over the highest N of that id that day', () => {
    const tags = [
      'probe@2026.1122.1',
      'probe@2026.1122.2',
      'probe@2026.1121.7',
      'fixture@2026.1122.5',
    ];
    expect(dateVersion('probe', tags, new Date('2026-11-22T10:00:00Z'))).toBe('2026.1122.3');
    expect(dateVersion('probe', ['probe@2026.1122.9'], new Date('2026-11-22'))).toBe(
      '2026.1122.10'
    );
  });

  it('a day prefix of another day is not that day: 2026.112 is not 2026.1122', () => {
    expect(dateVersion('probe', ['probe@2026.112.4'], new Date('2026-11-22'))).toBe('2026.1122.1');
  });

  it('the tag form is <id>@<version>', () => {
    expect(tagOf('probe', '2027.105.1')).toBe('probe@2027.105.1');
  });
});

describe('the last <id>@* tag', () => {
  it('compares numbers, not text: N=10 after 9, January after December', () => {
    expect(lastTag('probe', ['probe@2026.1122.9', 'probe@2026.1122.10'])).toBe(
      'probe@2026.1122.10'
    );
    expect(lastTag('probe', ['probe@2027.105.1', 'probe@2026.1231.4'])).toBe('probe@2027.105.1');
  });

  it('skips another id, a leading zero and a prerelease; none is undefined', () => {
    const tags = ['probe-api@2030.101.1', 'probe@2027.0105.1', 'probe@2028.101.1-rc.1', 'v1.0.0'];
    expect(lastTag('probe', [...tags, 'probe@0.3.0'])).toBe('probe@0.3.0');
    expect(lastTag('probe', tags)).toBeUndefined();
    expect(versionOfTag('probe', 'fixture@2026.1122.1')).toBeUndefined();
  });
});
