import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { fixture, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { extensionsDir } from '../paths.js';
import { discover, type DiscoveredExtension } from './discover.js';

const [HELLO, WORLD, DUP] = [pkg('hello'), pkg('world'), pkg('dup-id')];

const find = (names: string[], dev: Record<string, string> = {}, config = {}) =>
  discover({ extensionsDir: extensionsDir(), names, dev, config });

const byPkg = (found: DiscoveredExtension[], name: string) => found.find((e) => e.pkg === name);

// A package written by hand into the tree's node_modules.
const place = (dir: ConfigDir, name: string, manifest: Record<string, unknown>): void =>
  dir.write(join(dir.tree(), 'node_modules', name, 'package.json'), manifest);

// An index.js that leaves a file behind if anything ever imports it.
const tripwire = (dir: ConfigDir, entry: string): string => {
  const marker = dir.at('imported');
  dir.write(
    entry,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '');\n`
  );
  return marker;
};

describe('finding extensions on disk', () => {
  test('an installed extension is read from its package.json: version, id, commands, peers, entry', ({
    dir,
  }) => {
    const tree = dir.tree('hello', 'world');
    const { extensions, warnings } = find([HELLO, WORLD]);
    expect(warnings).toEqual([]);
    expect(extensions).toEqual([
      expect.objectContaining({
        pkg: HELLO,
        source: 'tree',
        version: '1.0.0',
        id: 'hello',
        commands: ['hello'],
        entry: join(tree, 'node_modules', HELLO, 'index.js'),
        problem: null,
        missing: false,
      }),
      expect.objectContaining({ pkg: WORLD, id: 'world', peers: [HELLO], problem: null }),
    ]);
  });

  test("the profile's config for an extension is checked against its manifest, defaults filled", ({
    dir,
  }) => {
    dir.tree('hello', 'secret');
    const [hello, secret] = find([HELLO, pkg('secret')]).extensions;
    expect(hello).toMatchObject({ config: { greeting: 'hello' }, secrets: [], problem: null });
    expect(secret).toMatchObject({ config: {}, secrets: ['token'] });
    const wrong = find([HELLO], {}, { hello: { greeting: 3 } }).extensions[0];
    expect(wrong?.problem).toBe('config.hello.greeting: must be of type string (got number)');
  });

  test('an extension whose engines.agentage does not match is invalid and never imported', ({
    dir,
  }) => {
    const tree = dir.tree('old-engine');
    const marker = tripwire(dir, join(tree, 'node_modules', pkg('old-engine'), 'index.js'));
    expect(find([pkg('old-engine')]).extensions[0]?.problem).toBe(
      'engines.agentage "^0.1" does not match extension API 1.0.0'
    );
    expect(dir.exists(marker)).toBe(false);
  });

  test('a dev path replaces the installed copy of the same package', ({ dir }) => {
    dir.tree('hello');
    const { extensions } = find([HELLO], { [HELLO]: fixture('hello') });
    expect(extensions).toEqual([
      expect.objectContaining({ pkg: HELLO, source: 'dev', dir: fixture('hello'), problem: null }),
    ]);
  });

  test('a dev path with another package but the same id makes both invalid, naming each other', ({
    dir,
  }) => {
    dir.tree('hello');
    const { extensions } = find([HELLO], { [DUP]: fixture('dup-id') });
    expect(extensions.map((e) => e.problem)).toEqual([
      `duplicate id "hello" (also ${DUP})`,
      `duplicate id "hello" (also ${HELLO})`,
    ]);
  });

  test('a dev path must be absolute, and one with no package.json is missing', () => {
    const dev = { '@agentage/rel': 'relative/path', '@agentage/gone': '/nowhere/gone' };
    expect(find([], dev).extensions.map((e) => [e.problem, e.missing])).toEqual([
      ['dev path not absolute', false],
      [null, true],
    ]);
  });

  test('a profile extension absent from the tree, or with a broken package.json, is missing', ({
    dir,
  }) => {
    dir.write(join(dir.tree(), 'node_modules', 'broken', 'package.json'), '{ nope');
    expect(find(['@agentage/absent', 'broken']).extensions.map((e) => e.missing)).toEqual([
      true,
      true,
    ]);
  });

  test('an entry outside the package or not on disk, or no entry at all, makes it invalid', ({
    dir,
  }) => {
    const ext = (id: string, main?: string) => ({ name: id, agentage: { id }, main });
    place(dir, 'esc', ext('esc', '../x.js'));
    place(dir, 'nofile', ext('nofile', 'x.js'));
    place(dir, 'noentry', ext('noentry'));
    expect(find(['esc', 'nofile', 'noentry']).extensions.map((e) => e.problem)).toEqual([
      'entry ../x.js is outside the package',
      'entry x.js not found',
      'no entry point (exports or main)',
    ]);
  });

  test('a peer the tree holds as a plain library is not an extension peer; an unknown one is', ({
    dir,
  }) => {
    place(dir, 'lib', { name: 'lib', version: '1.0.0' });
    const peerDependencies = { lib: '^1', [HELLO]: '^1', '@agentage/absent': '^1' };
    place(dir, 'p', { name: 'p', main: 'package.json', agentage: { id: 'p' }, peerDependencies });
    expect(byPkg(find(['p']).extensions, 'p')?.peers).toEqual([HELLO, '@agentage/absent']);
  });

  test('an unfinished tree is ignored with a warning, and its extensions are missing', ({
    dir,
  }) => {
    dir.write('extensions/trees/unfinished/package.json', '{}');
    dir.write('extensions/current', 'unfinished\n');
    const result = find([WORLD]);
    expect(result.warnings).toEqual(['extensions tree "unfinished" is incomplete and was ignored']);
    expect(result.extensions).toEqual([expect.objectContaining({ missing: true, peers: [] })]);
  });

  test('extensions/current naming anything but a tree under trees/ is ignored with a warning', ({
    dir,
  }) => {
    dir.write('extensions/current', '../escape\n');
    expect(find([WORLD]).warnings).toEqual(['extensions/current: bad tree "../escape"']);
  });

  test('with no extensions/current nothing is installed, without a warning', () => {
    expect(find([WORLD])).toEqual({
      extensions: [expect.objectContaining({ missing: true })],
      warnings: [],
    });
  });
});
