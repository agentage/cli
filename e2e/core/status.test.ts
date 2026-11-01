/**
 * @offline - `agentage status` with AGENTAGE_MODULES=1 adds three lines (machine, profile,
 * modules), and with the flag off every command behaves exactly as before.
 */
import { expect, test } from './cli.js';

test.describe('agentage status @offline', () => {
  test('agentage status on an empty config dir says "no profile" and "modules 0" @smoke', async ({
    cli,
  }) => {
    const run = await cli.run('status');
    expect(run.code).toBe(0);
    expect(run.lines).toContainEqual(expect.stringMatching(/^machine {4}m_[0-9a-f]{8} \(.+\)$/));
    expect(run.lines).toContain('profile    no profile');
    expect(run.lines).toContain('modules    0');
    expect(cli.list('')).toEqual(['machine.json']);
    expect(cli.homeFiles()).toEqual([]);
  });

  test('agentage status after setup --profile two.json shows the file profile and modules 2 @p0', async ({
    cli,
  }) => {
    await cli.run('setup --profile fixtures/profiles/two.json');
    const run = await cli.run('status');
    expect(run.lines).toContain('profile    version 1 (source: file)');
    expect(run.lines).toContain('modules    2');
    const json = JSON.parse((await cli.run('status --json')).stdout);
    expect(json).toMatchObject({ profile: { version: 1, source: 'file' }, modules: 2 });
    expect(json.machine.id).toBe(cli.json('machine.json')['id']);
  });

  test('agentage status with an invalid profile.json prints the report, then exits 1 @p0', async ({
    cli,
  }) => {
    cli.write('profile.json', { version: 1, modules: { '@agentage/fixture-hello': 'file:../x' } });
    const run = await cli.run('status');
    expect(run.code).toBe(1);
    expect(run.lines).toContain('profile    invalid');
    expect(run.stderr).toContain('modules["@agentage/fixture-hello"]: file: specs are refused');
  });
});

test.describe('without AGENTAGE_MODULES=1 @p0 @offline', () => {
  test('agentage status, setup --profile and module behave exactly as before', async ({
    launcherMachine,
  }) => {
    const cli = launcherMachine({ AGENTAGE_MODULES: undefined });
    const status = await cli.run('status --json');
    const keys = ['version', 'fqdn', 'env', 'target', 'auth', 'endpoint', 'update'];
    expect(Object.keys(JSON.parse(status.stdout))).toEqual(keys);
    const setup = await cli.run('setup --profile fixtures/profiles/two.json');
    expect(setup.code).toBe(2);
    expect(setup.stderr).toContain("error: unknown option '--profile'");
    const group = await cli.run('module list');
    expect(group.code).toBe(2);
    expect(group.stderr).toContain("error: unknown command 'module'");
    expect(cli.list('')).toEqual([]);
  });
});
