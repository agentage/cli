/**
 * @offline - an extension built on the extension kit: `extension install <path>` links its working
 * copy, its commands run as `agentage <command>` and always as `agentage <id> <command>` through
 * the kit, a name someone else has keeps only the namespaced form, `extension doctor` checks its
 * command entry, and `extension up`, `down` and `token` reach the kit's tool library.
 */
import { realpathSync } from 'node:fs';
import { expect, test, type Machine } from './cli.js';

const PROBE = './fixtures/extension-probe';
const PONG = './fixtures/extension-pong';
const PROBE_OK = 'probe  ok         @agentage/fixture-probe 0.2.0 (dev)  commands: ping';

const linked = async (cli: Machine, ...paths: string[]): Promise<void> => {
  for (const path of paths) expect((await cli.run(`extension install ${path}`)).code).toBe(0);
};

test.describe('agentage extension install <path> of a kit-built working copy @p0 @offline', () => {
  test('agentage extension install ./fixtures/extension-probe links it and lists probe ok with ping', async ({
    cli,
  }) => {
    const run = await cli.run(`extension install ${PROBE}`);
    expect(run.code).toBe(0);
    expect(run.lines[0]).toBe('linked     @agentage/fixture-probe (working copy)');
    expect(run.lines).toContain(PROBE_OK);
    expect(cli.json('machine.json')['dev']).toEqual({
      '@agentage/fixture-probe': realpathSync(PROBE),
    });
    expect(cli.exists('profile.json')).toBe(false);
  });

  test('agentage extension doctor checks its command entry through the kit: probe ok', async ({
    cli,
  }) => {
    await linked(cli, PROBE);
    const doctor = await cli.run('extension doctor');
    expect(doctor.code).toBe(0);
    expect(doctor.lines.filter((line) => line !== '')).toEqual([PROBE_OK]);
    expect(cli.json('state/probe.json')).toMatchObject({ state: 'ok', version: '0.2.0' });
  });
});

test.describe('agentage <command> of a kit-built extension @p0 @offline', () => {
  test('agentage ping prints pong; agentage ping hi prints pong hi', async ({ cli }) => {
    await linked(cli, PROBE);
    expect(await cli.run('ping')).toMatchObject({ code: 0, stdout: 'pong\n' });
    expect(await cli.run('ping hi')).toMatchObject({ code: 0, stdout: 'pong hi\n' });
  });

  test('agentage probe ping and agentage probe ping hi run the same command', async ({ cli }) => {
    await linked(cli, PROBE);
    expect(await cli.run('probe ping')).toMatchObject({ code: 0, stdout: 'pong\n' });
    expect(await cli.run('probe ping hi')).toMatchObject({ code: 0, stdout: 'pong hi\n' });
  });

  test('agentage ping a b is a usage error from the kit, exit 2; agentage ping --help is the kit help', async ({
    cli,
  }) => {
    await linked(cli, PROBE);
    const usage = await cli.run('ping a b');
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain('too many arguments: b');
    const help = await cli.run('ping --help');
    expect(help.code).toBe(0);
    expect(help.lines[0]).toBe('usage: agentage ping [msg] [--json]');
  });

  test('agentage probe --help lists ping from the manifest', async ({ cli }) => {
    await linked(cli, PROBE);
    const help = await cli.run('probe --help');
    expect(help.code).toBe(0);
    expect(help.lines).toContain('Usage: agentage probe [options] [command]');
    expect(help.lines).toContain('  ping        answer pong');
  });
});

test.describe('a kit command whose name is taken keeps only agentage <id> <command> @p0 @offline', () => {
  test('agentage extension install of pong after probe says so; agentage ping stays probe', async ({
    cli,
  }) => {
    await linked(cli, PROBE);
    const pong = await cli.run(`extension install ${PONG}`);
    expect(pong.code).toBe(0);
    expect(pong.lines).toContain(
      'namespaced agentage pong ping (agentage ping is taken by extension probe)'
    );
    expect(pong.lines).toContain(
      'namespaced agentage pong status (agentage status is a core command)'
    );
    expect(await cli.run('ping')).toMatchObject({ code: 0, stdout: 'pong\n' });
    expect(await cli.run('pong ping')).toMatchObject({ code: 0, stdout: 'pong from pong\n' });
  });

  test('agentage status stays the core status; agentage pong status runs the kit command', async ({
    cli,
  }) => {
    await linked(cli, PROBE, PONG);
    const status = await cli.run('status');
    expect(status.code).toBe(0);
    expect(status.lines[0]).toMatch(/^version {4}/);
    expect(await cli.run('pong status')).toMatchObject({ code: 0, stdout: 'pong status\n' });
  });

  test('agentage extension list shows what to type in the commands column', async ({ cli }) => {
    await linked(cli, PROBE, PONG);
    const list = await cli.run('extension list');
    const rows = list.lines.filter((line) => line !== '');
    expect(rows.map((line) => line.replace(/ {2}last run: .*$/, ''))).toEqual([
      'pong   installed  @agentage/fixture-pong 0.2.0 (dev)  commands: pong ping, pong status',
      'probe  installed  @agentage/fixture-probe 0.2.0 (dev)  commands: ping',
    ]);
  });

  test('installing probe again after pong keeps agentage ping with probe, the earlier install', async ({
    cli,
  }) => {
    await linked(cli, PROBE, PONG, PROBE);
    expect(cli.json('commands.json')).toEqual({ ping: '@agentage/fixture-probe' });
    expect(await cli.run('ping')).toMatchObject({ code: 0, stdout: 'pong\n' });
  });
});

test.describe('agentage extension up, down and token reach the kit @offline', () => {
  test('agentage extension up and down in a folder that is not an extension fail with the kit message, exit 1', async ({
    cli,
  }) => {
    for (const verb of ['up', 'down']) {
      const run = await cli.run(`extension ${verb} --dir ./e2e`);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain('package.json');
    }
  });

  test('agentage extension token with no dev issuer running exits 1 naming extension up', async ({
    cli,
  }) => {
    const run = await cli.run('extension token --scope probe:write --issuer http://127.0.0.1:9');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      'no dev issuer at http://127.0.0.1:9: run agentage extension up first'
    );
    expect(run.stdout).toBe('');
  });

  test('agentage extension token without --scope, or with an issuer that is not http(s), is usage, exit 2', async ({
    cli,
  }) => {
    expect((await cli.run('extension token')).code).toBe(2);
    expect((await cli.run('extension token --scope probe:write --issuer ftp://x')).code).toBe(2);
  });
});
