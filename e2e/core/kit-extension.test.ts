/**
 * @offline - an extension built on the extension kit: `extension install <path>` links its working
 * copy, its commands run as `agentage <command>` and always as `agentage <id> <command>` through
 * the kit, a name someone else has keeps only the namespaced form, `extension doctor` checks its
 * command entry, and `extension up`, `down` and `token` reach the kit's tool library.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Machine, type Run } from './cli.js';

const PROBE = './fixtures/extension-probe';
const PONG = './fixtures/extension-pong';
const PROBE_OK = 'probe  ok         @agentage/fixture-probe 0.2.0 (dev)  commands: ping';

// A working copy in machine.json dev, as cli 0.51 linked it: the commands come from the old list
// until the daemon's first start moves it into installation.json.
const linked = async (cli: Machine, ...paths: string[]): Promise<void> => {
  const dev = Object.fromEntries(
    paths.map((path) => [
      JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8')).name,
      realpathSync(path),
    ])
  );
  cli.write('machine.json', {
    id: 'm_0000beef',
    name: 'box',
    dev,
    profileSource: 'default',
    accountId: null,
    profileEtag: null,
  });
};

const said = ({ code, stdout, stderr }: Run) => ({
  code,
  stdout,
  stderr: stderr.split('\n').filter((line) => line !== ''),
});

test.describe('agentage extension install <path> of a kit-built working copy @p0 @offline', () => {
  test('agentage extension doctor checks its command entry through the kit: probe ok', async ({
    cli,
  }) => {
    await linked(cli, PROBE);
    const doctor = await cli.run('extension doctor');
    expect(doctor.code).toBe(0);
    expect(doctor.lines.filter((line) => line !== '')).toEqual([PROBE_OK]);
    expect(cli.json('state/probe.json')).toMatchObject({ state: 'ok', version: '0.2.0' });
  });

  test('agentage extension doctor of a working copy whose handlers differ from its commands fails with the kit reason, exit 1', async ({
    cli,
  }) => {
    const pang = cli.fixture('probe', { '"name": "ping"': '"name": "pang"' });
    await linked(cli, pang);
    const doctor = await cli.run('extension doctor');
    expect(said(doctor)).toMatchObject({ code: 1, stderr: ['1 extension failed to load: probe'] });
    expect(doctor.lines.filter((line) => line !== '')).toEqual([
      'probe  failed     @agentage/fixture-probe 0.2.0 (dev)  commands: pang  "cli handlers [ping] differ from commands [pang]"',
    ]);
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
    expect(said(await cli.run('ping a b'))).toEqual({
      code: 2,
      stdout: '',
      stderr: ['too many arguments: b'],
    });
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
  test('agentage status stays the core status; agentage pong status runs the kit command', async ({
    cli,
  }) => {
    await linked(cli, PROBE, PONG);
    const status = await cli.run('status');
    expect(status.code).toBe(0);
    expect(status.lines[0]).toMatch(/^version {4}/);
    expect(await cli.run('pong status')).toMatchObject({ code: 0, stdout: 'pong status\n' });
  });
});

test.describe('agentage extension up, down and token reach the kit @offline', () => {
  test('agentage extension up and down in a folder that is not an extension fail with the kit message, exit 1', async ({
    cli,
  }) => {
    const message = `no package.json in ${resolve('e2e')}: run it in an extension package folder`;
    for (const verb of ['up', 'down'])
      expect(said(await cli.run(`extension ${verb} --dir ./e2e`))).toEqual({
        code: 1,
        stdout: '',
        stderr: [message],
      });
  });

  test('agentage extension token with no dev issuer running exits 1 naming extension up', async ({
    cli,
  }) => {
    const run = await cli.run('extension token --scope probe:write --issuer http://127.0.0.1:9');
    expect(said(run)).toEqual({
      code: 1,
      stdout: '',
      stderr: ['no dev issuer at http://127.0.0.1:9: run agentage extension up first'],
    });
  });

  test('agentage extension token without --scope, or with an issuer that is not http(s), is usage, exit 2', async ({
    cli,
  }) => {
    expect(said(await cli.run('extension token'))).toMatchObject({
      code: 2,
      stderr: ["error: required option '--scope <scope>' not specified"],
    });
    const ftp = await cli.run('extension token --scope probe:write --issuer ftp://x');
    expect(said(ftp)).toMatchObject({
      code: 2,
      stderr: [
        "error: option '--issuer <url>' argument 'ftp://x' is invalid. not an http: or https: URL.",
      ],
    });
  });
});
