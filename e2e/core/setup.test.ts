/**
 * @offline - `agentage setup`: the profile file it saves and refuses, and plain `setup` signing
 * in at the loopback site first. The install goes through the daemon, which this tier leaves off
 * (AGENTAGE_NO_DAEMON=1); the lifecycle tier of agentage/e2e runs it.
 */
import { expect, test } from './cli.js';

const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage setup --profile @p0 @offline', () => {
  test('agentage setup --profile saves profile.json from the file; with the daemon off it installs nothing', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect(run.code).toBe(0);
    expect(run.lines).toContain('extensions the daemon is off, nothing installed');
    expect(Object.keys(cli.json('profile.json')['extensions'] as object)).toEqual([
      '@agentage/fixture-hello',
      '@agentage/fixture-world',
    ]);
    expect(cli.json('machine.json')).toMatchObject({ profileSource: 'file' });
    expect(cli.exists('extensions')).toBe(false);
  });

  test('agentage setup --profile --dry-run prints the registries and the plan, and writes nothing', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)} --dry-run`);
    expect(run.code).toBe(0);
    expect(run.lines).toContain('dry run    nothing written');
    expect(run.lines).toContain(`registry   @agentage  ${cli.registry.url}`);
    expect(run.lines).toContain('registry   default    https://registry.npmjs.org');
    expect(run.lines).toContain('+ add @agentage/fixture-hello ^1.0.0');
    expect(run.lines).toContain('plan: 2 to add, 0 off, 0 already installed');
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
});

test.describe('agentage setup (signs in) @p0 @offline', () => {
  test('agentage setup signs in, then creates the default profile in your account and installs no extensions', async ({
    cli,
  }) => {
    const run = await cli.signIn();
    expect(run.code).toBe(0);
    expect(run.output).toMatch(/^profile {4}created in your account \(etag "\S+"\)$/m);
    expect(cli.json('profile.json')).toEqual({
      version: 1,
      extensions: {},
      config: {},
      machines: {},
    });
    expect(cli.exists('auth.json')).toBe(true);
  });

  test('agentage setup after setup --profile reads the saved profile.json, not your account', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(again.lines).toContain(
      'profile    from a file (setup --profile), not synced with your account'
    );
    expect(again.lines).toContain('extensions the daemon is off, nothing installed');
  });
});
