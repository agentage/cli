/**
 * @offline - the profile in your account with AGENTAGE_EXTENSIONS=1. Plain `setup` pulls it and
 * never pushes; the first signed-in `setup` creates it; `extension install`, `extension remove` and
 * `--off` push it once the new tree loaded; a push that loses a race replays once. The account is
 * the machine's loopback site: `cli.site` holds its profile and logs what the CLI sent.
 */
import { expect, test, type Machine } from './cli.js';

const HELLO = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const WORLD = 'world  ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world';
const PKG = { hello: '@agentage/fixture-hello', world: '@agentage/fixture-world' };
const DEFAULT = { version: 1, extensions: {}, config: {}, machines: {} };

// The account already holds a profile (routing @agentage to the loopback registry); setup pulls it.
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

  test('agentage setup installs the profile your account holds and pushes nothing; run again it sends If-None-Match and keeps the local copy', async ({
    cli,
  }) => {
    const { etag, run } = await connected(cli, { hello: '^1.0.0' });
    expect(run.output).toContain(`profile    pulled from your account (etag ${etag})`);
    expect(run.output).toContain(HELLO);
    const again = await cli.run('setup --no-browser');
    expect(again.code).toBe(0);
    expect(again.lines).toContain(HELLO);
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
    expect(run.lines).toContain(HELLO);
  });

  test('when your account answers 503 and there is no local profile.json, agentage setup exits 1 and installs nothing', async ({
    cli,
  }) => {
    cli.site.fail('profile');
    const run = await cli.signIn();
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('cloud profile unavailable and there is no local profile.json');
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

test.describe('agentage extension install and remove push to your account @p0 @offline', () => {
  test('agentage extension install @agentage/fixture-hello pushes profile, lock and npm major with If-Match once hello loaded', async ({
    cli,
  }) => {
    const { etag } = await connected(cli);
    const run = await cli.run('extension install @agentage/fixture-hello');
    expect(run.code).toBe(0);
    expect(run.lines).toContain(HELLO);
    const [put] = puts(cli);
    expect(put).toMatchObject({ ifMatch: etag, status: 200 });
    expect(put?.body).toMatchObject({
      version: 1,
      profile: { extensions: { [PKG.hello]: '^1.0.0' } },
      lock: { packages: { [`node_modules/${PKG.hello}`]: { version: '1.0.0' } } },
      npmMajor: expect.any(Number),
    });
    const stored = cli.site.profile()?.etag;
    expect(run.lines).toContain(`profile    pushed to your account (etag ${stored})`);
    expect(cli.json('machine.json')['profileEtag']).toBe(stored);
  });

  test("agentage extension remove hello pushes the profile without it; --off pushes this machine's off list", async ({
    cli,
  }) => {
    await connected(cli, { hello: '^1.0.0' });
    expect((await cli.run('extension remove hello')).code).toBe(0);
    expect(cli.site.profile()?.profile['extensions']).toEqual({});
    expect((await cli.run('extension install @agentage/fixture-hello --off')).code).toBe(0);
    const id = String(cli.json('machine.json')['id']);
    expect(cli.site.profile()?.profile['machines']).toEqual({
      [id]: { off: [PKG.hello], config: {} },
    });
    expect(puts(cli).map((put) => put.status)).toEqual([200, 200]);
  });

  test('when another machine pushed first (412), agentage extension install replays on the newer profile, installs again and pushes once more', async ({
    cli,
  }) => {
    await connected(cli);
    cli.site.conflict({ world: '^1' });
    const run = await cli.run('extension install @agentage/fixture-hello');
    expect(run.code).toBe(0);
    expect(puts(cli).map((put) => put.status)).toEqual([412, 200]);
    expect(run.lines).toContain(
      'profile    changed in your account meanwhile, replaying this change on it'
    );
    expect(run.lines).toContain(WORLD);
    expect(cli.site.profile()?.profile['extensions']).toEqual({
      [PKG.hello]: '^1.0.0',
      [PKG.world]: '^1',
    });
  });

  test('when another machine pushed first twice, agentage extension install exits 1 showing both documents', async ({
    cli,
  }) => {
    await connected(cli);
    cli.site.conflict({ world: '^1' }, { secret: '^1' });
    const run = await cli.run('extension install @agentage/fixture-hello');
    expect(run.code).toBe(1);
    expect(puts(cli).map((put) => put.status)).toEqual([412, 412]);
    expect(run.stderr).toContain('not pushed: the profile in your account changed again');
    expect(run.stderr).toMatch(/yours:\n\{[\s\S]*"@agentage\/fixture-hello"/);
    expect(run.stderr).toMatch(
      /in your account \(etag "[^"]+"\):\n\{[\s\S]*"@agentage\/fixture-secret"/
    );
  });

  test('agentage extension install after setup --profile pushes nothing', async ({ cli }) => {
    await connected(cli);
    expect((await cli.run(`setup --profile ${cli.profile({ extensions: {} })}`)).code).toBe(0);
    const before = cli.site.requests('/v1/profile').length;
    expect((await cli.run('extension install @agentage/fixture-hello')).code).toBe(0);
    expect(cli.site.requests('/v1/profile')).toHaveLength(before);
  });
});
