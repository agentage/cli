/**
 * @offline - `agentage status` with AGENTAGE_EXTENSIONS=1 adds three lines (machine, profile,
 * extensions), and with the flag off every command behaves exactly as before.
 */
import { expect, test } from './cli.js';

const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage status @offline', () => {
  test('agentage status on an empty config dir says "no profile" and "extensions 0" @smoke', async ({
    cli,
  }) => {
    const run = await cli.run('status');
    expect(run.code).toBe(0);
    expect(run.lines).toContainEqual(expect.stringMatching(/^machine {4}m_[0-9a-f]{8} \(.+\)$/));
    expect(run.lines).toContain('profile    no profile');
    expect(run.lines).toContain('extensions 0');
    expect(cli.list('')).toEqual(['machine.json']);
    expect(cli.homeFiles()).toEqual([]);
  });

  test('agentage status after setup --profile with hello and world shows the file profile and extensions 2 @p0', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const run = await cli.run('status');
    expect(run.lines).toContain('profile    version 1 (source: file)');
    expect(run.lines).toContain('extensions 2');
    const json = JSON.parse((await cli.run('status --json')).stdout);
    expect(json).toMatchObject({ profile: { version: 1, source: 'file' }, extensions: 2 });
    expect(json.machine.id).toBe(cli.json('machine.json')['id']);
  });

  test('agentage status with an invalid profile.json prints the report, then exits 1 @p0', async ({
    cli,
  }) => {
    cli.write('profile.json', {
      version: 1,
      extensions: { '@agentage/fixture-hello': 'file:../x' },
    });
    const run = await cli.run('status');
    expect(run.code).toBe(1);
    expect(run.lines).toContain('profile    invalid');
    expect(run.stderr).toContain('extensions["@agentage/fixture-hello"]: file: specs are refused');
  });
});

test.describe('without AGENTAGE_EXTENSIONS=1 @p0 @offline', () => {
  test('agentage status, setup --profile and extension behave exactly as before', async ({
    anotherMachine,
  }) => {
    const cli = anotherMachine({ AGENTAGE_EXTENSIONS: undefined });
    const status = await cli.run('status --json');
    const keys = ['version', 'fqdn', 'env', 'target', 'auth', 'endpoint', 'update'];
    expect(Object.keys(JSON.parse(status.stdout))).toEqual(keys);
    const setup = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect(setup.code).toBe(2);
    expect(setup.stderr).toContain("error: unknown option '--profile'");
    const group = await cli.run('extension list');
    expect(group.code).toBe(2);
    expect(group.stderr).toContain("error: unknown command 'extension'");
    expect(cli.list('')).toEqual([]);
  });

  test('with hello installed, agentage hello is an unknown command and --help is unchanged', async ({
    cli,
    anotherMachine,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const off = { AGENTAGE_EXTENSIONS: undefined };
    const hello = await cli.run('hello', off);
    expect(hello.code).toBe(2);
    expect(hello.stderr).toContain("error: unknown command 'hello'");
    expect(hello.stderr).not.toContain('core:');
    const fresh = anotherMachine(off);
    expect((await cli.run('--help', off)).stdout).toBe((await fresh.run('--help')).stdout);
  });
});
