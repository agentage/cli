import { realpathSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { fixture, MACHINE_ID, output, pkg, test } from '../../test/config-dir.js';
import { manifestFromFixtures, npmFromFixtures } from '../../test/npm-fixtures.js';
import {
  runExtensionInstall,
  type ExtensionInstallDeps,
  type ExtensionInstallOptions,
} from './install.js';

const deps: ExtensionInstallDeps = { npm: npmFromFixtures, manifest: manifestFromFixtures() };

const install = (name: string, opts: Omit<ExtensionInstallOptions, 'name'> = {}) =>
  output(() => runExtensionInstall({ name, ...opts }, deps));

const HELLO_OK = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const HELLO_DIR = realpathSync(fixture('hello'));

describe('agentage extension install', () => {
  test('on a new machine saves a default profile.json with the package pinned to ^ its latest version, installs and loads it', async ({
    dir,
  }) => {
    const run = await install(pkg('hello'));
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'added      @agentage/fixture-hello ^1.0.0',
      expect.stringMatching(/^install {4}1 extension in tree [0-9a-f]{16} \(npm install\)$/),
      HELLO_OK,
    ]);
    expect(dir.json('profile.json')).toEqual({
      version: 1,
      extensions: { [pkg('hello')]: '^1.0.0' },
      config: {},
      machines: {},
    });
    expect(dir.json('machine.json')['profileSource']).toBe('default');
    expect(dir.json('state/hello.json')).toMatchObject({ state: 'ok' });
  });

  test('keeps a file source, the registries and the other extensions; installing a name again updates its spec', async ({
    dir,
  }) => {
    dir.write('machine.json', { id: MACHINE_ID, name: 'box', dev: {}, profileSource: 'file' });
    dir.profile({
      extensions: { hello: '^1.0.0' },
      registries: { '@agentage': 'http://127.0.0.1:9' },
    });
    expect((await install(`${pkg('world')}@^1`)).error).toBeNull();
    const again = await install(`${pkg('hello')}@~1.0.0`);
    expect(again.lines).toContain(HELLO_OK.replace('^1.0.0', '~1.0.0'));
    expect(dir.json('profile.json')).toMatchObject({
      extensions: { [pkg('hello')]: '~1.0.0', [pkg('world')]: '^1' },
      registries: { '@agentage': 'http://127.0.0.1:9' },
    });
    expect(dir.json('machine.json')['profileSource']).toBe('file');
  });

  test("--off adds it to this machine's off list: installed, listed off, never loaded", async ({
    dir,
  }) => {
    dir.machine();
    const run = await install(pkg('secret'), { off: true });
    expect(run.lines).toContain('added      @agentage/fixture-secret ^1.0.0 (off on this machine)');
    expect(run.lines).toContain('secret  off        @agentage/fixture-secret 1.0.0 (wants ^1.0.0)');
    expect(dir.json('profile.json')['machines']).toEqual({
      [MACHINE_ID]: { off: [pkg('secret')], config: {} },
    });
    expect(dir.exists('state/secret.json')).toBe(false);
  });

  test('without --off, an extension this machine turned off loads again', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' }, off: ['hello'] });
    expect((await install(pkg('hello'))).lines).toContain(HELLO_OK);
    expect(dir.json('profile.json')['machines']).toEqual({ [MACHINE_ID]: { off: [], config: {} } });
  });

  test('a local path goes to machine.json dev as its real path, not into profile.json, and loads as dev', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    const run = await install(fixture('hello'));
    expect(run.lines[0]).toBe(`dev        @agentage/fixture-hello ${HELLO_DIR}`);
    expect(run.lines).toContain(
      'hello  ok         @agentage/fixture-hello 1.0.0 (dev)  commands: hello'
    );
    expect(dir.json('machine.json')['dev']).toEqual({ [pkg('hello')]: HELLO_DIR });
    expect(dir.json('profile.json')['extensions']).toEqual({ [pkg('hello')]: '^1.0.0' });
  });

  test('--off with a local path is refused, writing nothing: a dev extension always loads', async ({
    dir,
  }) => {
    expect((await install(fixture('hello'), { off: true })).error).toBe(
      `--off does not apply to ${HELLO_DIR}: a dev extension always loads`
    );
    expect(dir.list('')).toEqual([]);
  });

  test('a refused name, or an invalid profile.json, writes nothing', async ({ dir }) => {
    expect((await install('file:../x')).error).toMatch(/^file:\.\.\/x: file: is refused; /);
    expect(dir.list('')).toEqual([]);
    dir.write('profile.json', { version: 0 });
    expect((await install(pkg('hello'))).error).toBe(
      'profile.json is invalid:\n  version: must be 1 (got 0)'
    );
    expect(dir.list('')).toEqual(['profile.json']);
  });

  test('fails naming an extension that did not load, after printing the rows', async () => {
    const run = await install(pkg('throws'));
    expect(run.lines).toContain(
      'throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1.0.0)  "boom"'
    );
    expect(run.error).toBe('1 extension failed to load: throws');
  });
});
