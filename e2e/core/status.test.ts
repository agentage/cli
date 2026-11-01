/**
 * @offline - `agentage status` adds three lines (machine, profile, extensions) after the ones it
 * always printed, the profile line comparing the copy here with your account's; and a machine
 * upgraded from 0.39 runs setup and status as before, plus those lines.
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

test.describe('agentage status and the profile in your account @p0 @offline', () => {
  test("agentage status shows the local etag, and your account's version and etag once another machine pushed", async ({
    cli,
  }) => {
    const etag = cli.site.store({ extensions: {} });
    expect((await cli.signIn()).code).toBe(0);
    expect((await cli.run('status')).lines).toContain(
      `profile    version 1 (source: cloud, etag ${etag})`
    );
    const newer = cli.site.store({ extensions: { hello: '^1.0.0' } });
    expect((await cli.run('status')).lines).toContain(
      `profile    version 1 (source: cloud, etag ${etag}); account: version 1, etag ${newer} - run agentage setup`
    );
  });
});

test.describe('a machine upgraded from 0.39 @p0 @offline', () => {
  const UNSET = { AGENTAGE_EXTENSIONS: undefined };

  test('agentage setup --help keeps the 0.39 usage and flags, then lists --profile, --dry-run, --check, --latest and --json', async ({
    cli,
  }) => {
    const help = await cli.run('setup --help', UNSET);
    expect(help.code).toBe(0);
    expect(help.lines.slice(0, 3)).toEqual([
      'Usage: agentage setup [options]',
      '',
      'Sign in and connect this machine to your agentage account',
    ]);
    const flags = help.lines.filter((l) => l.startsWith('  --')).map((l) => l.trim().split(' ')[0]);
    expect(flags).toEqual([
      '--disconnect',
      '--reauth',
      '--no-browser',
      '--profile',
      '--dry-run',
      '--check',
      '--latest',
      '--json',
    ]);
  });

  test('agentage status on a fresh machine prints the 0.39 lines, then machine, profile and extensions, and exits 0; --json keeps the 0.39 keys first', async ({
    cli,
  }) => {
    const run = await cli.run('status', UNSET);
    expect(run.code).toBe(0);
    const at = (label: string) => run.lines.findIndex((l) => l.startsWith(`${label} `));
    const labels = ['version', 'update', 'target', 'auth', 'endpoint', 'machine', 'profile'];
    expect(labels.map(at)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(run.lines.slice(6, 8)).toEqual(['profile    no profile', 'extensions 0']);
    const json = JSON.parse((await cli.run('status --json', UNSET)).stdout);
    expect(Object.keys(json)).toEqual([
      ...['version', 'fqdn', 'env', 'target', 'auth', 'endpoint', 'update'],
      ...['machine', 'profile', 'extensions', 'plan'],
    ]);
  });

  test('without AGENTAGE_EXTENSIONS, or with it set to 0, agentage setup --profile, extension list and agentage hello work', async ({
    cli,
  }) => {
    const install = await cli.run(`setup --profile ${cli.profile(TWO)}`, UNSET);
    expect(install.code).toBe(0);
    const list = await cli.run('extension list', { AGENTAGE_EXTENSIONS: '0' });
    expect(list.code).toBe(0);
    expect(list.lines).toContainEqual(expect.stringMatching(/^hello {2}installed /));
    const hello = await cli.run('hello', { AGENTAGE_EXTENSIONS: '0' });
    expect(hello.code).toBe(0);
    expect(hello.lines).toContain('hello from hello');
  });

  test('with only auth.json, against an account without the profile and machines routes, agentage setup prints one dim line, installs nothing, shows the status and exits 0', async ({
    cli,
  }) => {
    expect((await cli.signIn()).code).toBe(0);
    for (const name of cli.list('').filter((n) => n !== 'auth.json')) cli.remove(name);
    cli.site.fail('profile', 'missing');
    cli.site.fail('machines', 'missing');
    const run = await cli.run('setup --no-browser', UNSET);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Already signed in');
    expect(run.stderr.split('\n').filter((l) => l.includes('profile'))).toEqual([
      'cloud profile unavailable and no local profile.json, nothing installed (404 NOT_FOUND)',
    ]);
    expect(run.lines).toContain('profile    no profile');
    expect(run.lines).toContain('extensions 0');
    expect(cli.exists('profile.json')).toBe(false);
    expect(cli.exists('extensions')).toBe(false);
    const status = JSON.parse((await cli.run('status --json', UNSET)).stdout);
    expect(status.machine.registered).toBeNull();
  });
});
