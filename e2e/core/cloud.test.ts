/**
 * @offline - the profile in your account. Plain `setup` pulls it and never pushes; the first
 * signed-in `setup` creates it. `extension install` and `remove` no longer push: the daemon's
 * installation.json is this machine's list. The account is the machine's
 * loopback site: `cli.site` holds its profile and logs what the CLI sent.
 */
import { expect, test, type Machine } from './cli.js';

// The tier runs with AGENTAGE_NO_DAEMON=1: plain setup installs only through the daemon.
const DAEMON_OFF = 'extensions the daemon is off, nothing installed';
const DEFAULT = { version: 1, extensions: {}, config: {}, machines: {} };

// The account holds a profile (routing @agentage to the loopback registry); setup pulls it.
const connected = async (cli: Machine, extensions: Record<string, string> = {}) => {
  const etag = cli.site.store({ extensions });
  const run = await cli.signIn();
  expect(run.code, run.output).toBe(0);
  return { etag, run };
};

const puts = (cli: Machine) => cli.site.requests('/v1/profile').filter((r) => r.method === 'PUT');

test.describe('agentage setup and the profile in your account @p0 @offline', () => {
  test('the first signed-in agentage setup, with no profile in the account, saves the default and creates it there with If-None-Match: *', async ({
    cli,
  }) => {
    const run = await cli.signIn();
    expect(run.code).toBe(0);
    expect(cli.json('profile.json')).toEqual(DEFAULT);
    const etag = cli.site.profile()?.etag;
    expect(run.output).toContain(`profile    created in your account (etag ${etag})`);
    expect(puts(cli)).toMatchObject([
      { ifNoneMatch: '*', status: 201, body: { version: 1, profile: DEFAULT, lock: null } },
    ]);
    expect(cli.json('machine.json')).toMatchObject({
      profileSource: 'cloud',
      profileEtag: etag,
      accountId: 'stub-user',
    });
  });

  test('agentage setup pulls the profile your account holds and pushes nothing; with the daemon off it installs nothing; run again it sends If-None-Match', async ({
    cli,
  }) => {
    const { etag, run } = await connected(cli, { hello: '^1.0.0' });
    expect(run.output).toContain(`profile    pulled from your account (etag ${etag})`);
    expect(run.output).toContain(DAEMON_OFF);
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(cli.site.requests('/v1/profile').at(-1)).toMatchObject({
      method: 'GET',
      ifNoneMatch: etag,
      status: 304,
    });
    expect(puts(cli)).toEqual([]);
  });

  test('when your account answers 503, agentage setup uses the local profile.json, says so and exits 0', async ({
    cli,
  }) => {
    await connected(cli, { hello: '^1.0.0' });
    cli.site.fail('profile');
    const run = await cli.run('setup --no-browser');
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('cloud profile unavailable, using local profile.json (503');
    expect(run.lines).toContain(DAEMON_OFF);
  });

  test('when your account answers 503 and there is no local profile.json, agentage setup says so on one dim line, installs nothing and exits 0', async ({
    cli,
  }) => {
    cli.site.fail('profile');
    const run = await cli.signIn();
    expect(run.code).toBe(0);
    expect(run.stderr.split('\n').filter((l) => l.includes('cloud profile'))).toEqual([
      'cloud profile unavailable and no local profile.json, nothing installed (503 INTERNAL)',
    ]);
    expect(run.output).toMatch(/^extensions 0$/m);
    expect(cli.exists('profile.json')).toBe(false);
    expect(cli.exists('extensions')).toBe(false);
  });

  test('agentage setup --profile makes no call to your account; a later agentage setup says the profile is from a file and leaves your account profile alone', async ({
    cli,
  }) => {
    await connected(cli);
    const before = cli.site.requests().length;
    expect((await cli.run(`setup --profile ${cli.profile({ extensions: {} })}`)).code).toBe(0);
    expect(cli.site.requests()).toHaveLength(before);
    const pulls = cli.site.requests('/v1/profile').length;
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(again.lines).toContain(
      'profile    from a file (setup --profile), not synced with your account'
    );
    expect(cli.site.requests('/v1/profile')).toHaveLength(pulls);
  });

  test('agentage setup signed in to another account than the one this machine is connected to exits 1, naming both and setup --disconnect', async ({
    cli,
  }) => {
    await connected(cli);
    cli.write('machine.json', { ...cli.json('machine.json'), accountId: 'someone-else' });
    const before = cli.site.requests().length;
    const run = await cli.run('setup --no-browser');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      'this machine is connected to account someone-else, but you are signed in as stub-user;'
    );
    expect(run.stderr).toContain('run agentage setup --disconnect, then agentage setup');
    expect(cli.site.requests()).toHaveLength(before);
  });
});
