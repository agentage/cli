/**
 * @offline - `agentage extension list` with AGENTAGE_EXTENSIONS=1: one row per extension, read
 * from the installed tree, the profile and the state files; extension code is never loaded.
 */
import { expect, test } from './cli.js';

const LAST_RUN = { at: '2026-10-29T10:00:00.000Z', pid: 4242, state: 'ok', error: null };
const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage extension list @p0 @offline', () => {
  test('agentage extension list prints one row per extension; --json adds machine and profile', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    cli.write('state/hello.json', LAST_RUN);
    const list = await cli.run('extension list');
    expect(list.code).toBe(0);
    expect(list.lines).toEqual([
      'hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  last run: ok at 2026-10-29T10:00:00.000Z',
      'world  installed  @agentage/fixture-world 1.0.0 (wants ^1)  commands: world',
      '',
    ]);
    const json = JSON.parse((await cli.run('extension list --json')).stdout);
    expect(Object.keys(json)).toEqual(['machine', 'profile', 'extensions']);
    expect(json.extensions.map((m: { id: string }) => m.id)).toEqual(['hello', 'world']);
  });

  test('agentage extension list marks a duplicate id and an old engine invalid, and blocks world', async ({
    cli,
  }) => {
    const all = { 'dup-id': '^1.0.0', hello: '^1.0.0', 'old-engine': '^1.0.0', world: '^1' };
    await cli.run(`setup --profile ${cli.profile({ extensions: all })}`);
    const list = await cli.run('extension list');
    expect(list.code).toBe(0);
    expect(list.lines).toEqual([
      'hello      invalid    @agentage/fixture-dup-id 1.0.0 (wants ^1.0.0)  duplicate id "hello" (also @agentage/fixture-hello)',
      'hello      invalid    @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  duplicate id "hello" (also @agentage/fixture-dup-id)',
      'oldengine  invalid    @agentage/fixture-old-engine 1.0.0 (wants ^1.0.0)  engines.agentage "^0.1" does not match extension API 1.0.0',
      'world      blocked    @agentage/fixture-world 1.0.0 (wants ^1)  commands: world  peer @agentage/fixture-hello is invalid',
      '',
    ]);
  });

  test('agentage extension list shows hello off and world blocked when this machine turns hello off', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile({ ...TWO, off: ['hello'] })}`);
    const list = await cli.run('extension list');
    expect(list.lines).toContain(
      'hello  off        @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
    expect(list.lines).toContain(
      'world  blocked    @agentage/fixture-world 1.0.0 (wants ^1)  commands: world  peer @agentage/fixture-hello is off'
    );
  });

  test('agentage extension list and agentage status write nothing over an installed config dir', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const before = cli.snapshot();
    expect((await cli.run('extension list')).code).toBe(0);
    expect((await cli.run('status')).code).toBe(0);
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage extension prints its help and exits 0; agentage extension nope exits 2', async ({
    cli,
  }) => {
    const help = await cli.run('extension');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: agentage extension');
    const nope = await cli.run('extension nope');
    expect(nope.code).toBe(2);
    expect(nope.stderr).toContain("unknown command 'nope'");
  });
});
