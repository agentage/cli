/**
 * @offline - `agentage extension install` with AGENTAGE_EXTENSIONS=1: a package name or tarball
 * URL goes into profile.json, a local path into machine.json `dev`, `--off` into this machine's
 * off list; then it installs and loads the way setup does, and never signs in.
 */
import { realpathSync } from 'node:fs';
import { expect, test, type Machine } from './cli.js';

const HELLO = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';

// The profile a site serves before anything is installed: `@agentage` from the loopback registry.
const routed = async (cli: Machine): Promise<void> => {
  expect((await cli.run(`setup --profile ${cli.profile({ extensions: {} })}`)).code).toBe(0);
};

test.describe('agentage extension install @p0 @offline', () => {
  test('agentage extension install @agentage/fixture-hello installs it pinned to ^1.0.0 and lists it ok', async ({
    cli,
  }) => {
    await routed(cli);
    const run = await cli.run('extension install @agentage/fixture-hello');
    expect(run.code).toBe(0);
    expect(run.lines).toContain(HELLO);
    expect(cli.json('profile.json')['extensions']).toEqual({ '@agentage/fixture-hello': '^1.0.0' });
    const tree = `extensions/trees/${cli.file('extensions/current')}`;
    expect(cli.list(`${tree}/node_modules/@agentage`)).toEqual(['fixture-hello']);
  });

  test('agentage extension install @agentage/fixture-hello@^1.0.0 keeps the range; installing it again with ~1.0.0 updates it', async ({
    cli,
  }) => {
    await routed(cli);
    expect((await cli.run('extension install @agentage/fixture-hello@^1.0.0')).lines).toContain(
      HELLO
    );
    const again = await cli.run('extension install @agentage/fixture-hello@~1.0.0');
    expect(again.code).toBe(0);
    expect(again.lines).toContain(HELLO.replace('^1.0.0', '~1.0.0'));
    expect(cli.json('profile.json')['extensions']).toEqual({ '@agentage/fixture-hello': '~1.0.0' });
  });

  test('agentage extension install @agentage/fixture-secret --off installs it, never loads it, and lists it off', async ({
    cli,
  }) => {
    await routed(cli);
    expect((await cli.run('extension install @agentage/fixture-secret --off')).code).toBe(0);
    const id = String(cli.json('machine.json')['id']);
    expect(cli.json('profile.json')['machines']).toEqual({
      [id]: { off: ['@agentage/fixture-secret'], config: {} },
    });
    const list = await cli.run('extension list');
    expect(list.lines).toContain(
      'secret  off        @agentage/fixture-secret 1.0.0 (wants ^1.0.0)'
    );
    expect(cli.exists('state/secret.json')).toBe(false);
  });

  test('agentage extension install @agentage/fixture-hello twice: the second load gets previousVersion 1.0.0, and so does agentage hello', async ({
    cli,
  }) => {
    await routed(cli);
    expect((await cli.run('extension install @agentage/fixture-hello')).code).toBe(0);
    expect((await cli.run('extension install @agentage/fixture-hello')).code).toBe(0);
    const run = await cli.run('hello --previous');
    expect(run.lines).toContain('previous version: 1.0.0');
    const logged = cli
      .file('logs/hello.log')
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(logged.map((entry) => entry.previousVersion)).toEqual([null, '1.0.0', '1.0.0']);
  });

  test('agentage extension install ./fixtures/extension-hello with hello installed puts its real path in machine.json and lists hello as dev', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile({ extensions: { hello: '^1.0.0' } })}`);
    const run = await cli.run('extension install ./fixtures/extension-hello');
    expect(run.code).toBe(0);
    const path = realpathSync('fixtures/extension-hello');
    expect(cli.json('machine.json')['dev']).toEqual({ '@agentage/fixture-hello': path });
    expect(cli.json('profile.json')['extensions']).toEqual({ '@agentage/fixture-hello': '^1.0.0' });
    const json = JSON.parse((await cli.run('extension list --json')).stdout);
    expect(json.extensions).toMatchObject([{ id: 'hello', mode: 'dev', state: 'installed' }]);
  });

  test('agentage hello after extension install of an edited copy of hello runs the copy: "howdy from hello"', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile({ extensions: { hello: '^1.0.0' } })}`);
    const copy = cli.fixture('hello', { '"default": "hello"': '"default": "howdy"' });
    expect((await cli.run(`extension install ${copy}`)).code).toBe(0);
    const run = await cli.run('hello');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('howdy from hello');
  });

  test('agentage extension install refuses http:, file: and npm: naming the rule, writing nothing', async ({
    cli,
  }) => {
    for (const spec of ['http://x/y.tgz', 'file:../x', 'npm:x']) {
      const run = await cli.run(`extension install ${spec}`);
      expect(run.code).toBe(1);
      const scheme = spec.slice(0, spec.indexOf(':') + 1);
      expect(run.stderr).toContain(`${spec}: ${scheme} is refused; install a package name`);
    }
    expect(cli.list('')).toEqual([]);
  });

  test('agentage extension install never signs in: the site gets no request and no auth.json is written', async ({
    cli,
    site,
  }) => {
    await routed(cli);
    expect((await cli.run('extension install @agentage/fixture-hello')).code).toBe(0);
    expect(site.state.requests).toEqual([]);
    expect(cli.exists('auth.json')).toBe(false);
  });
});
