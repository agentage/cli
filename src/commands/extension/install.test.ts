import { realpathSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { noAccount } from '../../test/account.js';
import { fixture, MACHINE_ID, output, pkg, test } from '../../test/config-dir.js';
import {
  manifestFromFixtures,
  npmFromFixtures,
  npmPublishing,
  type Publishes,
} from '../../test/npm-fixtures.js';
import {
  runExtensionInstall,
  type ExtensionInstallDeps,
  type ExtensionInstallOptions,
} from './install.js';

const deps: ExtensionInstallDeps = {
  npm: npmFromFixtures,
  manifest: manifestFromFixtures(),
  ...noAccount,
};

const install = (name: string, opts: Omit<ExtensionInstallOptions, 'name'> = {}) =>
  output(() => runExtensionInstall({ name, ...opts }, deps));

// The registry with `more` published: npm reads and installs from the same versions.
const publishing = (more: Publishes): ExtensionInstallDeps => ({
  ...deps,
  npm: npmPublishing(more),
  manifest: manifestFromFixtures(more),
});

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

  test('without a range picks the newest version that fits the extension API, saying which newer ones it skipped', async ({
    dir,
  }) => {
    const more = { [pkg('hello')]: { '1.0.1': {}, '2.0.0': { engines: { agentage: '^2' } } } };
    const run = await output(() => runExtensionInstall({ name: pkg('hello') }, publishing(more)));
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'skipped    2.0.0: needs extension API ^2',
      'added      @agentage/fixture-hello ^1.0.1',
      expect.stringMatching(/^install {4}1 extension in tree [0-9a-f]{16} \(npm install\)$/),
      HELLO_OK.replace('1.0.0 (wants ^1.0.0)', '1.0.1 (wants ^1.0.1)'),
    ]);
    expect(dir.json('profile.json')['extensions']).toEqual({ [pkg('hello')]: '^1.0.1' });
  });

  test('keeps a file source, the registries and the other extensions; installing a name again updates its spec', async ({
    dir,
  }) => {
    dir.machine();
    dir.write('machine.json', { ...dir.json('machine.json'), profileSource: 'file' });
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

describe('agentage extension install with a market', () => {
  const asking = (answer: { version: string; package: string | null } | null) => {
    const ids: string[] = [];
    const market = { latest: async (id: string) => (ids.push(id), answer) };
    return { ids, deps: { ...deps, market } };
  };

  test('a bare id takes the version the market names', async ({ dir }) => {
    const { ids, deps: withMarket } = asking({ version: '1.0.0', package: pkg('hello') });
    const run = await output(() => runExtensionInstall({ name: 'hello' }, withMarket));
    expect(run.error).toBeNull();
    expect(ids).toEqual(['hello']);
    expect(dir.json('profile.json').extensions).toEqual({ [pkg('hello')]: '1.0.0' });
  });

  test('an explicit version is unchanged and the market is not asked', async () => {
    const { ids, deps: withMarket } = asking({ version: '9.9.9', package: pkg('hello') });
    const run = await output(() => runExtensionInstall({ name: `${pkg('hello')}@^1` }, withMarket));
    expect(run.error).toBeNull();
    expect(ids).toEqual([]);
  });

  test('a private entry is refused on one line and nothing is written', async ({ dir }) => {
    const { deps: withMarket } = asking({ version: '0.2.1', package: null });
    const run = await output(() => runExtensionInstall({ name: 'fixture' }, withMarket));
    expect(run.error).toBe(
      'fixture: private entry, no npm package; it cannot be installed from npm'
    );
    expect(dir.exists('profile.json')).toBe(false);
  });

  test('an id the market does not know installs as today', async () => {
    const { deps: withMarket } = asking(null);
    const run = await output(() => runExtensionInstall({ name: pkg('hello') }, withMarket));
    expect(run.error).toBeNull();
  });
});
