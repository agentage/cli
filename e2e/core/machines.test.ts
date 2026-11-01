/**
 * @offline - this machine in your account with AGENTAGE_EXTENSIONS=1: a signed-in `setup`
 * registers it, `setup` and `status` mark it seen, `setup --disconnect` marks it disconnected. All
 * of it is fire and forget: an account that fails or never answers changes nothing on the screen
 * and no exit code. `setup --profile` registers nothing.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Machine } from './cli.js';

const VERSION = (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version;

const calls = (cli: Machine): string[] =>
  cli.site.requests('/v1/machines').map((r) => `${r.method} ${r.path}`);

test.describe('this machine in your account @p0 @offline', () => {
  test('agentage setup signed in, then status, then setup --disconnect: your account sees PUT, one seen per command, then PATCH disconnected', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    expect((await cli.run('status')).code).toBe(0);
    expect((await cli.run('setup --disconnect')).code).toBe(0);
    const { id, name } = cli.json('machine.json');
    const path = `/v1/machines/${String(id)}`;
    expect(calls(cli)).toEqual([
      `PUT ${path}`,
      `POST ${path}/seen`,
      `POST ${path}/seen`,
      `PATCH ${path}`,
    ]);
    const [put, , , patch] = cli.site.requests('/v1/machines');
    expect(put?.body).toEqual({
      name,
      platform: `${process.platform}-${process.arch}`,
      cliVersion: VERSION,
      state: 'connected',
    });
    expect(patch?.body).toEqual({ state: 'disconnected' });
    expect(cli.site.machines()).toMatchObject([{ id, name, state: 'disconnected' }]);
    expect(cli.json('machine.json')).toMatchObject({ accountId: null, profileEtag: null });
  });

  test('with your account answering 503 on /v1/machines, agentage setup, status and setup --disconnect still exit 0 and print nothing about it', async ({
    cli,
  }) => {
    cli.site.fail('machines');
    const setup = await cli.signIn();
    expect(setup.code).toBe(0);
    const status = await cli.run('status');
    expect(status.code).toBe(0);
    const disconnect = await cli.run('setup --disconnect');
    expect(disconnect.code).toBe(0);
    for (const text of [setup.output, status.stdout, status.stderr, disconnect.stderr])
      expect(text).not.toContain('machines');
    expect(calls(cli)).toHaveLength(4);
  });

  test('with your account never answering on /v1/machines, agentage setup and status still finish and exit 0', async ({
    cli,
  }) => {
    cli.site.fail('machines', 'hang');
    expect((await cli.signIn()).code).toBe(0);
    const started = Date.now();
    expect((await cli.run('status')).code).toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test('agentage setup --profile makes no call to /v1/machines, even signed in', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    const before = calls(cli).length;
    expect((await cli.run(`setup --profile ${cli.profile({ extensions: {} })}`)).code).toBe(0);
    expect(calls(cli)).toHaveLength(before);
  });

  test('agentage status --json says whether your account knows this machine: null signed out, true once registered', async ({
    cli,
  }) => {
    const signedOut = JSON.parse((await cli.run('status --json')).stdout);
    expect(signedOut.machine).toMatchObject({ registered: null });
    expect((await cli.signIn()).code).toBe(0);
    const registered = JSON.parse((await cli.run('status --json')).stdout);
    expect(registered.machine).toEqual({
      id: cli.json('machine.json')['id'],
      name: expect.any(String),
      registered: true,
    });
  });
});
