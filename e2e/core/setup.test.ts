/**
 * @offline - `agentage setup` with AGENTAGE_EXTENSIONS=1: installing the extensions a profile
 * names from the loopback registry, and plain `setup` signing in at the loopback site first.
 */
import { expect, test } from './cli.js';

const HELLO = 'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const WORLD = 'world  installed  @agentage/fixture-world 1.0.0 (wants ^1)  commands: world';

test.describe('agentage setup --profile @p0 @offline', () => {
  test('agentage setup --profile two.json installs hello and world without signing in', async ({
    cli,
  }) => {
    const run = await cli.run('setup --profile fixtures/profiles/two.json');
    expect(run.code).toBe(0);
    expect(run.lines).toContain(HELLO);
    expect(run.lines).toContain(WORLD);
    expect(cli.exists(`extensions/trees/${cli.file('extensions/current')}/.complete`)).toBe(true);
    expect(cli.json('machine.json')).toMatchObject({ profileSource: 'file' });
    expect(cli.exists('auth.json')).toBe(false);
    expect(cli.homeFiles()).toEqual([]);
  });

  test('running agentage setup --profile two.json again reuses the installed tree', async ({
    cli,
  }) => {
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    const again = await cli.run('setup --profile fixtures/profiles/two.json');
    const tree = cli.file('extensions/current');
    expect(again.lines).toContain(`install    2 extensions in tree ${tree} (reused)`);
    expect(cli.list('extensions/trees')).toEqual([tree]);
    expect(cli.json('extensions/package.json')).toEqual({
      name: 'agentage-extensions',
      private: true,
      dependencies: { '@agentage/fixture-hello': '^1.0.0', '@agentage/fixture-world': '^1' },
    });
  });

  test('agentage setup --profile two.json on two machines installs the same tree, so the locks match', async ({
    cli,
    launcherMachine,
  }) => {
    const other = launcherMachine();
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    expect((await other.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    expect(other.file('extensions/current')).toBe(cli.file('extensions/current'));
  });

  test('two agentage setup --profile runs at once: one waits for the other, both succeed', async ({
    cli,
  }) => {
    const first = cli.start('setup --profile fixtures/profiles/two.json');
    const second = cli.start('setup --profile fixtures/profiles/two.json');
    expect(await Promise.all([first.waitExit(60_000), second.waitExit(60_000)])).toEqual([0, 0]);
    const waited = [first, second].filter((p) =>
      p.stderr().includes('waiting for another install')
    );
    expect(waited).toHaveLength(1);
    expect(cli.list('extensions/trees')).toEqual([cli.file('extensions/current')]);
    expect(cli.exists('extensions/install.lock')).toBe(false);
  });

  test('agentage setup --profile two.json --dry-run prints the plan and writes nothing', async ({
    cli,
  }) => {
    const run = await cli.run('setup --profile fixtures/profiles/two.json --dry-run');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('dry run    nothing written');
    expect(run.lines).toContain(`registry   ${cli.registry.url}`);
    expect(run.lines).toContain('  @agentage/fixture-hello  ^1.0.0');
    expect(run.lines).toContain('npm        install --ignore-scripts (no lock yet)');
    expect(cli.exists('profile.json')).toBe(false);
    expect(cli.exists('extensions')).toBe(false);
  });

  test('agentage setup --profile refuses a package outside @agentage or a file: version, writing nothing', async ({
    cli,
  }) => {
    const scope = await cli.run('setup --profile fixtures/profiles/scope-bad.json');
    expect(scope.code).toBe(1);
    expect(scope.stderr).toContain('extensions["@acme/fixture-hello"]: refused by the scope rule');
    const spec = await cli.run('setup --profile fixtures/profiles/spec-bad.json');
    expect(spec.code).toBe(1);
    expect(spec.stderr).toContain('extensions["@agentage/fixture-hello"]: file: specs are refused');
    expect(cli.exists('profile.json')).toBe(false);
    expect(cli.exists('extensions')).toBe(false);
  });

  test('with AGENTAGE_EXTENSION_SCOPES=@acme, agentage setup --profile scope-bad.json --dry-run plans @acme', async ({
    launcherMachine,
  }) => {
    const cli = launcherMachine({ AGENTAGE_EXTENSION_SCOPES: '@acme' });
    const run = await cli.run('setup --profile fixtures/profiles/scope-bad.json --dry-run');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('  @acme/fixture-hello      ^1.0.0');
  });

  test('when npm fails, agentage setup --profile missing.json exits 1 and keeps the last good tree', async ({
    cli,
  }) => {
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    const good = cli.file('extensions/current');
    const failed = await cli.run('setup --profile fixtures/profiles/missing.json');
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('npm install failed');
    expect(failed.stderr).toContain('E404');
    expect(cli.file('extensions/current')).toBe(good);
    expect(cli.list('extensions/trees')).toEqual([good]);
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
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

  test('agentage setup after setup --profile two.json installs from the saved profile.json', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(again.stderr).toContain('cloud profile unavailable, using local profile.json');
    expect(again.lines).toContain(HELLO);
    expect(again.lines).toContain('extensions 2');
  });
});
