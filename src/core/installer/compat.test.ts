import { describe, expect, it } from 'vitest';
import { fits, fitsApi, needs, needsText, newestCompatible, parsePublished } from './compat.js';

const GATE = { api: '1.0.0', kit: '0.2.0' };

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
    expect(newestCompatible(versions, GATE)).toEqual({
      version: '1.0.1',
      skipped: published(['3.0.0', '^3'], ['2.0.0', '^2']),
    });
    expect(needs({ version: '2.0.0', engine: '^2' })).toBe('2.0.0: needs extension API ^2');
  });

  it('picks nothing when no version fits, and skips them all', () => {
    expect(newestCompatible(published(['2.0.0', '^2']), GATE)).toEqual({
      version: null,
      skipped: published(['2.0.0', '^2']),
    });
    expect(newestCompatible([], GATE)).toEqual({ version: null, skipped: [] });
  });
});

describe('the gate picks the API by manifest shape', () => {
  it('checks a kit-shaped range against the kit, any other against the extension API', () => {
    expect(fits({ engine: '^0.2', kit: true }, GATE)).toBe(true);
    expect(fits({ engine: '^0.2' }, GATE)).toBe(false);
    expect(fits({ engine: '^1', kit: true }, GATE)).toBe(false);
    expect(needsText({ engine: '^0.3', kit: true })).toBe('needs kit ^0.3');
    expect(needs({ version: '0.3.0', engine: '^0.3', kit: true })).toBe('0.3.0: needs kit ^0.3');
  });

  it('pins the newest kit-shaped version the kit can run, skipping newer ones', () => {
    const kit = [
      { version: '0.1.0', engine: '^0.1', kit: true },
      { version: '0.2.0', engine: '^0.2', kit: true },
      { version: '0.3.0', engine: '^0.3', kit: true },
    ];
    expect(newestCompatible(kit, GATE)).toEqual({ version: '0.2.0', skipped: [kit[2]] });
  });
});

describe('what npm view <name>@>=0.0.0 name version engines agentage.parts --json prints', () => {
  it('a version with agentage.parts is kit-shaped, its range has no default', () => {
    const stdout = JSON.stringify([
      { version: '0.1.0', engines: { agentage: '^0.1' }, 'agentage.parts': { api: true } },
      { version: '0.2.0', 'agentage.parts': { cli: true } },
    ]);
    expect(parsePublished(stdout)).toEqual([
      { version: '0.1.0', engine: '^0.1', kit: true },
      { version: '0.2.0', engine: '', kit: true },
    ]);
  });

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
