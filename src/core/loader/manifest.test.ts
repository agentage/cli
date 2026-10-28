import { describe, expect, it } from 'vitest';
import { entryOf, manifestInfo, manifestProblem, RESERVED_IDS } from './manifest.js';

const NAME = '@agentage/fixture-x';

const pkg = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: NAME,
  version: '1.2.3',
  main: 'index.js',
  agentage: { id: 'x' },
  ...extra,
});

const problemOf = (extra: Record<string, unknown>, api = '1.0.0'): string | null =>
  manifestProblem(NAME, manifestInfo(pkg(extra)), api);

describe('manifest', () => {
  it('reads id, engine, commands and plugin peers as data', () => {
    const info = manifestInfo(
      pkg({
        engines: { agentage: '^1.0' },
        agentage: { id: 'x', contributes: { commands: ['x', 'x:sub', 3] } },
        peerDependencies: { '@agentage/fixture-hello': '^1', express: '^5' },
        peerDependenciesMeta: { express: { optional: true }, other: 'no' },
      })
    );
    expect(info).toEqual({
      name: NAME,
      version: '1.2.3',
      id: 'x',
      engine: '^1.0',
      entry: 'index.js',
      commands: ['x', 'x:sub'],
      peers: ['@agentage/fixture-hello', 'express'],
      optionalPeers: ['express'],
    });
  });

  it('treats an absent engines.agentage as ^1 and missing blocks as empty', () => {
    const info = manifestInfo({ name: NAME });
    expect(info).toMatchObject({ engine: '^1', id: null, version: null, commands: [], peers: [] });
  });

  it.each([
    [{ exports: './a.js', main: 'b.js' }, './a.js'],
    [{ exports: { '.': './a.js' } }, './a.js'],
    [{ exports: { '.': { import: './i.js', default: './d.js' } } }, './i.js'],
    [{ exports: { '.': { require: './r.cjs', default: './d.js' } } }, './d.js'],
    [{ exports: { import: { types: './t.d.ts', default: './i.js' } } }, './i.js'],
    [{ exports: { require: './r.cjs' }, main: 'r.cjs' }, null],
    [{ exports: { './sub': './s.js' }, main: 'm.js' }, null],
    [{ exports: ['./a.js'] }, null],
    [{ main: 'm.js' }, 'm.js'],
    [{}, null],
  ])('resolves the entry of %j to %j', (fields, expected) => {
    expect(entryOf({ name: NAME, ...fields })).toBe(expected);
  });

  it('accepts a valid manifest', () => {
    expect(problemOf({})).toBeNull();
    expect(problemOf({ engines: { agentage: '>=1.0.0 <2' } })).toBeNull();
  });

  it.each([
    [{ name: 'other' }, 'package.json name "other" is not @agentage/fixture-x'],
    [{ agentage: {} }, 'agentage.id is missing'],
    [{ agentage: { id: 'Hello' } }, 'agentage.id "Hello" must match [a-z][a-z0-9-]*'],
    [{ agentage: { id: '1x' } }, 'must match'],
    [{ agentage: { id: 'status' } }, 'agentage.id "status" is reserved'],
    [{ agentage: { id: 'com1' } }, 'is reserved'],
    [{ engines: { agentage: '^0.1' } }, 'engines.agentage "^0.1" does not match plugin API 1.0.0'],
    [{ engines: { agentage: 'latest' } }, 'engines.agentage "latest" is not a supported range'],
    [{ main: undefined }, 'no entry point (exports or main)'],
  ])('marks %j invalid', (fields, message) => {
    expect(problemOf(fields)).toContain(message);
  });

  it('matches the engine against the given API version', () => {
    expect(problemOf({ engines: { agentage: '^2' } }, '2.1.0')).toBeNull();
    expect(problemOf({}, '2.0.0')).toContain('does not match plugin API 2.0.0');
  });

  it('reserves core commands and Windows device names', () => {
    for (const id of ['setup', 'status', 'update', 'add', 'remove', 'help', 'con', 'nul', 'lpt9'])
      expect(RESERVED_IDS.has(id), id).toBe(true);
    expect(RESERVED_IDS.has('hello')).toBe(false);
  });
});
