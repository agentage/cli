/**
 * @offline - `agentage module list` with AGENTAGE_MODULES=1: one row per module, read from the
 * installed tree, the profile and the state files; module code is never loaded.
 */
import { expect, test } from './cli.js';

const LAST_RUN = { at: '2026-10-29T10:00:00.000Z', pid: 4242, state: 'ok', error: null };

test.describe('agentage module list @p0 @offline', () => {
  test('agentage module list prints one row per module; --json adds machine and profile', async ({
    cli,
  }) => {
    await cli.run('setup --profile fixtures/profiles/two.json');
    cli.write('state/hello.json', LAST_RUN);
    const list = await cli.run('module list');
    expect(list.code).toBe(0);
    expect(list.lines).toEqual([
      'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  last run: ok at 2026-10-29T10:00:00.000Z',
      'world  installed  @agentage/fixture-world 1.0.0 (wants ^1)  commands: world',
      '',
    ]);
    const json = JSON.parse((await cli.run('module list --json')).stdout);
    expect(Object.keys(json)).toEqual(['machine', 'profile', 'modules']);
    expect(json.modules.map((m: { id: string }) => m.id)).toEqual(['hello', 'world']);
  });

  test('agentage module list marks a duplicate id and an old engine invalid, and blocks world', async ({
    cli,
  }) => {
    await cli.run('setup --profile fixtures/profiles/all.json');
    const list = await cli.run('module list');
    expect(list.code).toBe(0);
    expect(list.lines).toEqual([
      'hello      invalid    @agentage/fixture-dup-id 1.0.0 (wants ^1.0.0)  duplicate id "hello" (also @agentage/fixture-hello)',
      'hello      invalid    @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  duplicate id "hello" (also @agentage/fixture-dup-id)',
      'oldengine  invalid    @agentage/fixture-old-engine 1.0.0 (wants ^1.0.0)  engines.agentage "^0.1" does not match module API 1.0.0',
      'world      blocked    @agentage/fixture-world 1.0.0 (wants ^1)  commands: world  peer @agentage/fixture-hello is invalid',
      '',
    ]);
  });

  test('agentage module list shows hello off and world blocked when this machine turns hello off', async ({
    cli,
  }) => {
    cli.write('machine.json', {
      id: 'm_0000beef',
      name: 'e2e-box',
      dev: {},
      profileSource: 'default',
    });
    await cli.run('setup --profile fixtures/profiles/off-hello.json');
    const list = await cli.run('module list');
    expect(list.lines).toContain(
      'hello  off        @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
    expect(list.lines).toContain(
      'world  blocked    @agentage/fixture-world 1.0.0 (wants ^1)  commands: world  peer @agentage/fixture-hello is off'
    );
  });

  test('agentage module list and agentage status write nothing over an installed config dir', async ({
    cli,
  }) => {
    await cli.run('setup --profile fixtures/profiles/two.json');
    const before = cli.snapshot();
    expect((await cli.run('module list')).code).toBe(0);
    expect((await cli.run('status')).code).toBe(0);
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage module prints its help and exits 0; agentage module nope exits 2', async ({
    cli,
  }) => {
    const help = await cli.run('module');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: agentage module');
    const nope = await cli.run('module nope');
    expect(nope.code).toBe(2);
    expect(nope.stderr).toContain("unknown command 'nope'");
  });
});
