import { describe, expect, it } from 'vitest';
import { manifestInfo, manifestProblem } from './manifest.js';

const NAME = '@agentage/fixture-x';

const manifest = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: NAME,
  version: '1.2.3',
  main: 'index.js',
  agentage: { id: 'x' },
  ...extra,
});

const problemOf = (extra: Record<string, unknown>, api = '1.0.0'): string | null =>
  manifestProblem(NAME, manifestInfo(manifest(extra)), api);

describe("an extension's package.json", () => {
  it('is read as data: id, engine range, commands, peers and optional peers', () => {
    const info = manifestInfo(
      manifest({
        engines: { agentage: '^1.0' },
        agentage: { id: 'x', contributes: { commands: ['x', 'x:sub', 3] } },
        peerDependencies: { '@agentage/fixture-hello': '^1', express: '^5' },
        peerDependenciesMeta: { express: { optional: true }, other: 'no' },
      })
    );
    expect(info).toEqual({
      kind: 'api',
      name: NAME,
      version: '1.2.3',
      id: 'x',
      engine: '^1.0',
      entry: 'index.js',
      commands: ['x', 'x:sub'],
      peers: ['@agentage/fixture-hello', 'express'],
      optionalPeers: ['express'],
      configuration: {},
      kitCommands: [],
      shape: null,
    });
  });

  it('without engines.agentage wants extension API ^1; missing blocks read as empty', () => {
    expect(manifestInfo({ name: NAME })).toMatchObject({
      engine: '^1',
      id: null,
      version: null,
      commands: [],
      peers: [],
    });
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
  ])('finds the entry the way Node imports it: %j gives %j', (fields, entry) => {
    expect(manifestInfo({ name: NAME, ...fields }).entry).toBe(entry);
  });

  it('is valid with a matching engine range', () => {
    expect(problemOf({})).toBeNull();
    expect(problemOf({ engines: { agentage: '>=1.0.0 <2' } })).toBeNull();
    expect(problemOf({ engines: { agentage: '^2' } }, '2.1.0')).toBeNull();
  });

  it.each([
    [{ name: 'other' }, 'package.json name "other" is not @agentage/fixture-x'],
    [{ agentage: {} }, 'agentage.id is missing'],
    [{ agentage: { id: 'Hello' } }, 'agentage.id "Hello" must match [a-z][a-z0-9-]*'],
    [{ agentage: { id: '1x' } }, 'agentage.id "1x" must match [a-z][a-z0-9-]*'],
    [
      { engines: { agentage: '^0.1' } },
      'engines.agentage "^0.1" does not match extension API 1.0.0',
    ],
    [{ engines: { agentage: 'latest' } }, 'engines.agentage "latest" is not a supported range'],
    [{ main: null }, 'no entry point (exports or main)'],
    [
      { agentage: { id: 'x', contributes: { commands: ['x', 'setup'] } } },
      'agentage.contributes.commands: "setup" must be "x" or "x:<name>"',
    ],
    [
      { agentage: { id: 'x', contributes: { commands: ['x:Sub'] } } },
      'agentage.contributes.commands: "x:Sub" must be "x" or "x:<name>"',
    ],
  ])('is invalid with %j: %s', (fields, message) => {
    expect(problemOf(fields)).toBe(message);
  });

  it.each(['setup', 'status', 'update', 'extension', 'add', 'help', 'con', 'nul', 'com1', 'lpt9'])(
    'cannot claim the id %j: core commands and Windows device names are reserved',
    (id) => {
      expect(problemOf({ agentage: { id } })).toBe(`agentage.id "${id}" is reserved`);
    }
  );
});

describe('a kit-shaped package.json (agentage.parts)', () => {
  const PROBE = '@agentage/extension-probe';
  const ping = { name: 'ping', summary: 'answer pong', args: [{ name: 'msg', type: 'string' }] };
  const kit = (agentage: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    name: PROBE,
    version: '0.2.0',
    engines: { agentage: '^0.2' },
    agentage: { id: 'probe', parts: { api: true, cli: true }, commands: [ping], ...agentage },
    ...extra,
  });
  const problem = (agentage = {}, extra = {}, version = '0.2.1'): string | null =>
    manifestProblem(PROBE, manifestInfo(kit(agentage, extra)), '1.0.0', version);

  it('reads the command entry, the command names and summaries; it has no peers', () => {
    const info = manifestInfo(kit({}, { peerDependencies: { react: '^19' } }));
    expect(info).toMatchObject({
      kind: 'kit',
      id: 'probe',
      engine: '^0.2',
      entry: './dist/cli/index.js',
      commands: ['ping'],
      kitCommands: [{ name: 'ping', summary: 'answer pong' }],
      peers: [],
      shape: null,
    });
  });

  it('checks engines.agentage against the kit version, not the extension API', () => {
    expect(problem()).toBeNull();
    expect(problem({}, {}, '0.3.0')).toBe('engines.agentage "^0.2" does not match kit 0.3.0');
    expect(problem({}, { engines: {} })).toBe('engines.agentage is missing');
    expect(problem({}, { engines: { agentage: 'next' } })).toBe(
      'engines.agentage "next" is not a supported range'
    );
  });

  it('needs a valid id and a sound block; without parts.cli it has no entry and no commands', () => {
    expect(problem({ id: 'setup' })).toBe('agentage.id "setup" is reserved');
    expect(problem({ commands: [ping, ping] })).toBe('agentage.commands: "ping" is declared twice');
    const info = manifestInfo(kit({ parts: { api: true }, commands: [] }));
    expect(info.entry).toBeNull();
    expect(manifestProblem(PROBE, info, '1.0.0', '0.2.0')).toBeNull();
  });
});
