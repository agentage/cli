/**
 * @offline - `agentage setup --latest`: npm update in a staged copy of the installed tree, the
 * version diff, the new tree current only once every extension loaded clean, the profile pushed
 * to your account when it comes from there; and the rule behind it and `extension install`: the
 * newest version whose engines.agentage fits the extension API. Each test publishes the newer
 * versions it needs to its own loopback registry.
 */
import { expect, test, type Machine } from './cli.js';

const HELLO = '@agentage/fixture-hello';
const ONE = { extensions: { hello: '^1.0.0' } };
const NEEDS_API_2 = { engines: { agentage: '^2' } };

const helloOk = (version: string, range: string): string =>
  `hello  ok         ${HELLO} ${version} (wants ${range})  commands: hello`;

// The version of hello extensions/package-lock.json pins.
const lockedHello = (cli: Machine): string | undefined =>
  (cli.json('extensions/package-lock.json') as { packages: Record<string, { version: string }> })
    .packages[`node_modules/${HELLO}`]?.version;

const installedOne = async (cli: Machine): Promise<string> => {
  expect((await cli.run(`setup --profile ${cli.profile(ONE)}`)).code).toBe(0);
  return cli.file('extensions/current');
};

test.describe('agentage setup --latest @p0 @offline', () => {
  test('after hello 1.0.1 is published, agentage setup --latest installs it in a new tree, prints the diff and the summary, and only that tree is left', async ({
    cli,
  }) => {
    const old = await installedOne(cli);
    await cli.registry.publish('hello', '1.0.1');
    const run = await cli.run('setup --latest');
    expect(run.code, run.stderr).toBe(0);
    const tree = cli.file('extensions/current');
    expect(tree).not.toBe(old);
    expect(run.lines).toContain(`~ update ${HELLO} 1.0.0 -> 1.0.1`);
    expect(run.lines).toContain(`latest: 1 updated, 0 unchanged in tree ${tree}`);
    expect(run.lines).toContain(helloOk('1.0.1', '^1.0.0'));
    expect(cli.list('extensions/trees')).toEqual([tree]);
    expect(lockedHello(cli)).toBe('1.0.1');
    expect((await cli.run('extension list')).lines).toContainEqual(
      expect.stringMatching(/^hello {2}installed {2}@agentage\/fixture-hello 1\.0\.1 \(wants/)
    );
  });

  test('agentage setup --latest with nothing newer prints "latest: nothing to update" and builds no tree', async ({
    cli,
  }) => {
    await installedOne(cli);
    const before = cli.snapshot();
    const run = await cli.run('setup --latest');
    expect(run.code).toBe(0);
    expect(run.lines).toEqual(['latest: nothing to update', '']);
    expect(cli.snapshot()).toEqual(before);
  });

  test('when the newer hello does not load clean, agentage setup --latest exits 1 naming it and the old tree stays current', async ({
    cli,
  }) => {
    const old = await installedOne(cli);
    await cli.registry.publish('hello', '1.0.1', { main: 'missing.js' });
    const run = await cli.run('setup --latest');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('not updated: hello invalid; extensions/current is unchanged');
    expect(run.lines).toContainEqual(expect.stringMatching(/^hello {2}invalid .* 1\.0\.1 /));
    expect(cli.file('extensions/current')).toBe(old);
    expect(cli.list('extensions/trees')).toEqual([old]);
    expect(lockedHello(cli)).toBe('1.0.0');
  });

  test('on a machine whose profile comes from your account, agentage setup --latest pushes the new lock with If-Match once hello 1.0.1 loaded', async ({
    cli,
  }) => {
    const etag = cli.site.store(ONE);
    expect((await cli.signIn()).code).toBe(0);
    await cli.registry.publish('hello', '1.0.1');
    const run = await cli.run('setup --latest');
    expect(run.code, run.stderr).toBe(0);
    const puts = cli.site.requests('/v1/profile').filter((r) => r.method === 'PUT');
    const lock = { packages: { [`node_modules/${HELLO}`]: { version: '1.0.1' } } };
    expect(puts).toMatchObject([{ ifMatch: etag, status: 200, body: { lock } }]);
    const stored = cli.site.profile()?.etag;
    expect(run.lines).toContain(`profile    pushed to your account (etag ${stored})`);
  });
});

test.describe('the newest version that fits the extension API @p0 @offline', () => {
  test('with hello 2.0.0 needing extension API ^2 published, agentage extension install @agentage/fixture-hello picks 1.0.1 and says it skipped 2.0.0; setup --latest keeps 1.0.1', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile({ extensions: {} })}`)).code).toBe(0);
    await cli.registry.publish('hello', '1.0.1');
    await cli.registry.publish('hello', '2.0.0', NEEDS_API_2);
    const run = await cli.run(`extension install ${HELLO}`);
    expect(run.code, run.stderr).toBe(0);
    expect(run.lines).toContain('skipped    2.0.0: needs extension API ^2');
    expect(run.lines).toContain(`added      ${HELLO} ^1.0.1`);
    expect(run.lines).toContain(helloOk('1.0.1', '^1.0.1'));
    const latest = await cli.run('setup --latest');
    expect(latest.code).toBe(0);
    expect(latest.lines).toContain('latest: nothing to update');
    expect(lockedHello(cli)).toBe('1.0.1');
  });

  test('when the newest version its range allows needs extension API ^2, agentage setup --latest keeps hello at 1.0.0 and says why', async ({
    cli,
  }) => {
    const old = await installedOne(cli);
    await cli.registry.publish('hello', '1.1.0', NEEDS_API_2);
    const run = await cli.run('setup --latest');
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([
      `kept       ${HELLO} 1.0.0 (1.1.0 needs extension API ^2)`,
      'latest: nothing to update',
      '',
    ]);
    expect(cli.file('extensions/current')).toBe(old);
    expect(lockedHello(cli)).toBe('1.0.0');
  });
});
