import { describe, expect, it } from 'vitest';
import { fitsApi, needs, newestCompatible, parsePublished } from './compat.js';

const published = (...entries: [string, string][]) =>
  entries.map(([version, engine]) => ({ version, engine }));

describe('the compat gate: the newest version whose engines.agentage fits the extension API', () => {
  it('fits a range the API version satisfies; anything else, or no range at all, does not', () => {
    expect(fitsApi('^1', '1.0.0')).toBe(true);
    expect(fitsApi('>=1.0.0 <3', '1.0.0')).toBe(true);
    expect(fitsApi('^2', '1.0.0')).toBe(false);
    expect(fitsApi('latest', '1.0.0')).toBe(false);
  });

  it('picks the newest that fits and lists every newer one it skipped, newest first', () => {
    const versions = published(['1.0.0', '^1'], ['2.0.0', '^2'], ['1.0.1', '^1'], ['3.0.0', '^3']);
    expect(newestCompatible(versions, '1.0.0')).toEqual({
      version: '1.0.1',
      skipped: published(['3.0.0', '^3'], ['2.0.0', '^2']),
    });
    expect(needs({ version: '2.0.0', engine: '^2' })).toBe('2.0.0: needs extension API ^2');
  });

  it('picks nothing when no version fits, and skips them all', () => {
    expect(newestCompatible(published(['2.0.0', '^2']), '1.0.0')).toEqual({
      version: null,
      skipped: published(['2.0.0', '^2']),
    });
    expect(newestCompatible([], '1.0.0')).toEqual({ version: null, skipped: [] });
  });
});

describe('what npm view <name>@>=0.0.0 name version engines --json prints', () => {
  it('one object per version, engines.agentage absent meaning ^1', () => {
    const stdout = JSON.stringify([
      { name: 'x', version: '1.0.0', engines: { agentage: '^1', node: '>=22' } },
      { name: 'x', version: '2.0.0', engines: { node: '>=22' } },
    ]);
    expect(parsePublished(stdout)).toEqual(published(['1.0.0', '^1'], ['2.0.0', '^1']));
  });

  it('a lone object for one version, bare versions as npm unwraps them, nothing at all for none', () => {
    const one = JSON.stringify({ version: '2.0.0', engines: { agentage: '^2' } });
    expect(parsePublished(one)).toEqual(published(['2.0.0', '^2']));
    expect(parsePublished('"1.0.0"\n')).toEqual(published(['1.0.0', '^1']));
    expect(parsePublished('')).toEqual([]);
  });

  it('anything else is not an answer', () => {
    expect(parsePublished('not json')).toBeNull();
    expect(parsePublished('[{ "name": "x" }]')).toBeNull();
    expect(parsePublished('42')).toBeNull();
  });
});
