/**
 * @offline - `agentage setup` with AGENTAGE_EXTENSIONS=1: installing the extensions a profile
 * names from the loopback registry, and plain `setup` signing in at the loopback site first.
 * Loading what was installed: setup-load.test.ts.
 */
import { expect, test } from './cli.js';

const HELLO = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const WORLD = 'world  ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world';
const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage setup --profile @p0 @offline', () => {
  test('agentage setup --profile with hello and world installs both without signing in', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect(run.code).toBe(0);
    expect(run.lines).toContain(HELLO);
    expect(run.lines).toContain(WORLD);
    const tree = `extensions/trees/${cli.file('extensions/current')}`;
    expect(cli.exists(`${tree}/.complete`)).toBe(true);
    expect(cli.file(`${tree}/.npmrc`)).toBe(`@agentage:registry=${cli.registry}`);
    expect(cli.json('profile.json')['registries']).toEqual({ '@agentage': cli.registry });
    expect(cli.json('machine.json')).toMatchObject({ profileSource: 'file' });
    expect(cli.exists('auth.json')).toBe(false);
    expect(cli.homeFiles()).toEqual([]);
  });

  test('running agentage setup --profile again with the same extensions reuses the installed tree', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    const again = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const tree = cli.file('extensions/current');
    expect(again.lines).toContain(`install    2 extensions in tree ${tree} (reused)`);
    expect(cli.list('extensions/trees')).toEqual([tree]);
    expect(cli.json('extensions/package.json')).toEqual({
      name: 'agentage-extensions',
      private: true,
      dependencies: { '@agentage/fixture-hello': '^1.0.0', '@agentage/fixture-world': '^1' },
    });
  });

  test('agentage setup --profile with the same extensions on two machines installs the same tree', async ({
    cli,
    anotherMachine,
  }) => {
    const other = anotherMachine();
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    expect((await other.run(`setup --profile ${other.profile(TWO)}`)).code).toBe(0);
    expect(other.file('extensions/current')).toBe(cli.file('extensions/current'));
  });

  test('two agentage setup --profile runs at once: one waits for the other, both succeed', async ({
    cli,
  }) => {
    const profile = cli.profile(TWO);
    const first = cli.start(`setup --profile ${profile}`);
    const second = cli.start(`setup --profile ${profile}`);
    expect(await Promise.all([first.waitExit(60_000), second.waitExit(60_000)])).toEqual([0, 0]);
    const waited = [first, second].filter((p) =>
      p.stderr().includes('waiting for another install')
    );
    expect(waited).toHaveLength(1);
    expect(cli.list('extensions/trees')).toEqual([cli.file('extensions/current')]);
    expect(cli.exists('extensions/install.lock')).toBe(false);
  });

  test('agentage setup --profile --dry-run prints the registries and the plan, and writes nothing', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)} --dry-run`);
    expect(run.code).toBe(0);
    expect(run.lines).toContain('dry run    nothing written');
    expect(run.lines).toContain(`registry   @agentage  ${cli.registry}`);
    expect(run.lines).toContain('registry   default    https://registry.npmjs.org');
    expect(run.lines).toContain('  @agentage/fixture-hello  ^1.0.0');
    expect(run.lines).toContain('npm        install --ignore-scripts (no lock yet)');
    // update-check.json is the CLI's own update throttle, written after any command.
    expect(cli.list('').filter((name) => name !== 'update-check.json')).toEqual([]);
  });

  test('agentage setup --profile refuses a file: version, writing nothing', async ({ cli }) => {
    const run = await cli.run(
      `setup --profile ${cli.profile({ extensions: { hello: 'file:../x' } })}`
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('extensions["@agentage/fixture-hello"]: file: specs are refused');
    expect(cli.list('')).toEqual([]);
  });

  test('a profile that sends @acme to an http: registry that is not loopback is refused, naming registries["@acme"]', async ({
    cli,
  }) => {
    const registries = { '@acme': 'http://npm.acme.example' };
    const run = await cli.run(`setup --profile ${cli.profile({ ...TWO, registries })}`);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      'registries["@acme"]: must be an https: URL, or http: on a loopback host'
    );
    expect(cli.list('')).toEqual([]);
  });

  test('when npm fails, agentage setup --profile exits 1, still lists the extensions and keeps the last good tree', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    const good = cli.file('extensions/current');
    const missing = cli.profile({ extensions: { hello: '^1.0.0', missing: '^1.0.0' } });
    const failed = await cli.run(`setup --profile ${missing}`);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('npm install failed');
    expect(failed.stderr).toContain('E404');
    expect(failed.lines).toContainEqual(
      expect.stringMatching(/^hello  installed .* last run: ok /)
    );
    expect(cli.file('extensions/current')).toBe(good);
    expect(cli.list('extensions/trees')).toEqual([good]);
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
  });
});

test.describe('agentage setup (signs in) @p0 @offline', () => {
  test('agentage setup signs in, then saves the default profile and installs no extensions', async ({
    cli,
  }) => {
    const run = await cli.signIn();
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('cloud profile unavailable, using the default profile');
    expect(run.output).toMatch(/^install {4}no extensions in tree \S+ \(npm skipped\)$/m);
    expect(cli.json('profile.json')).toEqual({
      version: 1,
      extensions: {},
      config: {},
      machines: {},
    });
    expect(cli.exists('auth.json')).toBe(true);
  });

  test('agentage setup after setup --profile installs from the saved profile.json', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(again.stderr).toContain('cloud profile unavailable, using local profile.json');
    expect(again.lines).toContain(HELLO);
    expect(again.lines).toContain('extensions 2');
  });
});
