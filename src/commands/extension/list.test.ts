import { describe, expect } from 'vitest';
import { fixture, output, pkg, plain, test } from '../../test/config-dir.js';
import { runExtensionList } from './list.js';
import { summaryLines } from './row-lines.js';
import { gatherExtensions } from './rows.js';

const AT = '2026-10-29T10:00:00.000Z';
const HELLO_DEV = 'hello  installed  @agentage/fixture-hello 1.0.0 (dev)  commands: hello';

const list = () => output(() => runExtensionList({}));

describe('agentage extension list', () => {
  test('shows the last run from state/<id>.json; a failed run quotes its error', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    dir.write('state/hello.json', { at: AT, pid: 7, state: 'failed', error: 'boom' });
    expect((await list()).lines).toEqual([
      `hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  last run: failed "boom" at ${AT}`,
    ]);
  });

  test('never shows an invalid extension the last run of the id it claims', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1', 'dup-id': '^1' } });
    dir.tree('hello', 'dup-id');
    dir.write('state/hello.json', { at: AT, pid: 7, state: 'ok' });
    expect((await list()).lines).toEqual([
      'hello  invalid    @agentage/fixture-dup-id 1.0.0 (wants ^1)  duplicate id "hello" (also @agentage/fixture-hello)',
      'hello  invalid    @agentage/fixture-hello 1.0.0 (wants ^1)  commands: hello  duplicate id "hello" (also @agentage/fixture-dup-id)',
    ]);
  });

  test('adds a drift column after state when the tree differs from the profile: remove for what only the tree has', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    dir.tree('hello', 'world');
    dir.profile({ extensions: { hello: '^1.0.0' } });
    expect((await list()).lines).toEqual([
      'hello  installed          @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
      'world  installed  remove  @agentage/fixture-world 1.0.0 (not in profile)  commands: world',
    ]);
  });

  test('shows update for a changed range and add for what the tree lacks; --json has plan per row and in total', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    dir.profile({ extensions: { hello: '~1.0.0', world: '^1' } });
    expect((await list()).lines).toEqual([
      'hello  installed  update  @agentage/fixture-hello 1.0.0 (wants ~1.0.0)  commands: hello',
      '?      missing    add     @agentage/fixture-world - (wants ^1)  not installed in the current tree',
    ]);
    const json = JSON.parse((await output(() => runExtensionList({ json: true }))).stdout);
    expect(json.plan).toEqual({ add: 1, update: 1, remove: 0, off: 0, unchanged: 0 });
    expect(json.extensions.map((row: { plan: string }) => row.plan)).toEqual(['update', 'add']);
  });

  test('leaves the drift column out for an extension turned off here and a dev row; --json keeps plan off', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' }, off: ['world'] });
    dir.tree('hello', 'world');
    dir.machine({ secret: fixture('secret') });
    expect((await list()).lines).toEqual([
      'hello   installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
      'secret  installed  @agentage/fixture-secret 1.0.0 (dev)',
      'world   off        @agentage/fixture-world 1.0.0 (wants ^1)  commands: world',
    ]);
    const json = JSON.parse((await output(() => runExtensionList({ json: true }))).stdout);
    expect(json.extensions.map((row: { plan: string | null }) => row.plan)).toEqual([
      'unchanged',
      null,
      'off',
    ]);
  });

  test('lists a dev path from machine.json as a dev row', async ({ dir }) => {
    dir.machine({ hello: fixture('hello') });
    expect((await list()).lines).toEqual([HELLO_DEV]);
  });

  test('with an invalid profile.json still prints the rows, then fails naming each bad entry', async ({
    dir,
  }) => {
    dir.machine({ hello: fixture('hello') });
    dir.profile({ extensions: { world: 'file:../x' } });
    const run = await list();
    expect(run.lines).toEqual([HELLO_DEV]);
    expect(run.error).toBe(
      `profile.json is invalid:\n  extensions["${pkg('world')}"]: file: specs are refused; ` +
        'use a semver range or an https: tarball URL'
    );
  });

  test('with no extensions says so, and warns about keys profile.json does not know', async ({
    dir,
  }) => {
    dir.profile({ teams: ['a'] });
    expect(await list()).toMatchObject({
      lines: ['no extensions'],
      stderr: 'warning: profile.json: unknown key "teams" kept',
      error: null,
    });
  });
});

describe('agentage status', () => {
  test('adds this machine, the profile and the extension count, marking a newer profile read-only', async ({
    dir,
  }) => {
    dir.machine();
    dir.profile({ version: 2, extensions: { hello: '^1' } });
    expect(summaryLines((await gatherExtensions()).status).map(plain)).toEqual([
      'machine    m_0000beef (box)',
      'profile    version 2 (source: default, read-only)',
      'extensions 1 (1 to add)',
    ]);
  });

  test('names on the extensions line only what setup would change, never what is off', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    dir.tree('hello', 'world');
    dir.profile({ extensions: { hello: '^1.0.0', secret: '^1' }, off: ['hello'] });
    const [, , extensions] = summaryLines((await gatherExtensions()).status);
    expect(extensions).toBe('extensions 3 (1 to add, 1 to remove)');
  });
});

describe('agentage extension list with a market', () => {
  const market = {
    down: () => false,
    latest: async (id: string) => (id === 'hello' ? { version: '1.2.0', package: null } : null),
  };

  test('shows latest from the market per installed extension, - for an unknown one', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    dir.tree('hello', 'world');
    const run = await output(() => runExtensionList({}, market));
    expect(run.lines).toEqual([
      'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  latest 1.2.0  commands: hello',
      'world  installed  @agentage/fixture-world 1.0.0 (wants ^1)  latest -  commands: world',
    ]);
  });

  test('leaves the column out when the market is down', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    const down = { latest: async () => null, down: () => true };
    expect((await output(() => runExtensionList({}, down))).lines).toEqual([
      'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
    ]);
  });

  test('--json adds latest to each row', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    const json = JSON.parse((await output(() => runExtensionList({ json: true }, market))).stdout);
    expect(json.extensions.map((row: { latest: string }) => row.latest)).toEqual(['1.2.0']);
  });

  test('--json stays clean and has no latest when the market is down', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    const down = { latest: async () => null, down: () => true };
    const json = JSON.parse((await output(() => runExtensionList({ json: true }, down))).stdout);
    expect(json.extensions[0]).not.toHaveProperty('latest');
  });

  describe('one refused answer', () => {
    const refused = {
      down: () => false,
      latest: async (id: string) => {
        if (id === 'world') throw new Error('market answer refused for world: package "@evil/x"');
        return { version: '1.2.0', package: null };
      },
    };

    test('shows - for that row, one stderr line, and the full table', async ({ dir }) => {
      dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
      dir.tree('hello', 'world');
      const run = await output(() => runExtensionList({}, refused));
      expect(run.error).toBeNull();
      expect(run.lines).toEqual([
        'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  latest 1.2.0  commands: hello',
        'world  installed  @agentage/fixture-world 1.0.0 (wants ^1)  latest -  commands: world',
      ]);
      expect(run.stderr).toBe('market answer refused for world: package "@evil/x"');
    });

    test('--json stdout still parses, latest null for that row', async ({ dir }) => {
      dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
      dir.tree('hello', 'world');
      const run = await output(() => runExtensionList({ json: true }, refused));
      const rows = JSON.parse(run.stdout).extensions;
      expect(rows.map((r: { latest: string | null }) => r.latest)).toEqual(['1.2.0', null]);
    });
  });
});
