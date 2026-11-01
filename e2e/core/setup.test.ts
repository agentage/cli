/**
 * @offline - `agentage setup` with AGENTAGE_MODULES=1: installing the modules a profile names from
 * the loopback registry, and plain `setup` signing in at the loopback site first.
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
    expect(cli.exists(`modules/trees/${cli.file('modules/current')}/.complete`)).toBe(true);
    expect(cli.json('machine.json')).toMatchObject({ profileSource: 'file' });
    expect(cli.exists('auth.json')).toBe(false);
    expect(cli.homeFiles()).toEqual([]);
  });

  test('running agentage setup --profile two.json again reuses the installed tree', async ({
    cli,
  }) => {
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    const again = await cli.run('setup --profile fixtures/profiles/two.json');
    const tree = cli.file('modules/current');
    expect(again.lines).toContain(`install    2 modules in tree ${tree} (reused)`);
    expect(cli.list('modules/trees')).toEqual([tree]);
    expect(cli.json('modules/package.json')).toEqual({
      name: 'agentage-modules',
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
    expect(other.file('modules/current')).toBe(cli.file('modules/current'));
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
    expect(cli.list('modules/trees')).toEqual([cli.file('modules/current')]);
    expect(cli.exists('modules/install.lock')).toBe(false);
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
    expect(cli.exists('modules')).toBe(false);
  });

  test('agentage setup --profile refuses a package outside @agentage or a file: version, writing nothing', async ({
    cli,
  }) => {
    const scope = await cli.run('setup --profile fixtures/profiles/scope-bad.json');
    expect(scope.code).toBe(1);
    expect(scope.stderr).toContain('modules["@acme/fixture-hello"]: refused by the scope rule');
    const spec = await cli.run('setup --profile fixtures/profiles/spec-bad.json');
    expect(spec.code).toBe(1);
    expect(spec.stderr).toContain('modules["@agentage/fixture-hello"]: file: specs are refused');
    expect(cli.exists('profile.json')).toBe(false);
    expect(cli.exists('modules')).toBe(false);
  });

  test('with AGENTAGE_MODULE_SCOPES=@acme, agentage setup --profile scope-bad.json --dry-run plans @acme', async ({
    launcherMachine,
  }) => {
    const cli = launcherMachine({ AGENTAGE_MODULE_SCOPES: '@acme' });
    const run = await cli.run('setup --profile fixtures/profiles/scope-bad.json --dry-run');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('  @acme/fixture-hello      ^1.0.0');
  });

  test('when npm fails, agentage setup --profile missing.json exits 1 and keeps the last good tree', async ({
    cli,
  }) => {
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
    const good = cli.file('modules/current');
    const failed = await cli.run('setup --profile fixtures/profiles/missing.json');
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('npm install failed');
    expect(failed.stderr).toContain('E404');
    expect(cli.file('modules/current')).toBe(good);
    expect(cli.list('modules/trees')).toEqual([good]);
    expect((await cli.run('setup --profile fixtures/profiles/two.json')).code).toBe(0);
  });
});

test.describe('agentage setup (signs in) @p0 @offline', () => {
  test('agentage setup signs in, then saves the default profile and installs no modules', async ({
    cli,
  }) => {
    const run = await cli.signIn();
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('cloud profile unavailable, using the default profile');
    expect(run.output).toMatch(/^install {4}no modules in tree \S+ \(npm skipped\)$/m);
    expect(cli.json('profile.json')).toEqual({ version: 1, modules: {}, config: {}, machines: {} });
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
    expect(again.lines).toContain('modules    2');
  });
});
