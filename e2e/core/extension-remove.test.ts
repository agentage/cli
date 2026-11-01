/**
 * @offline - `agentage extension remove` with AGENTAGE_EXTENSIONS=1: by package name, short name
 * or extension id; refused while another extension peer-depends on it; `--purge` also deletes
 * data/<id>/; then the rest is installed again and loaded the way setup does.
 */
import { expect, test } from './cli.js';

const HELLO = { extensions: { hello: '^1.0.0' } };
const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage extension remove @p0 @offline', () => {
  test('agentage extension remove @agentage/fixture-hello with world installed exits 1 naming world and changes nothing', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const before = cli.snapshot();
    const run = await cli.run('extension remove @agentage/fixture-hello');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('@agentage/fixture-hello is needed by world; remove world first');
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage extension remove world, then remove hello, leaves a tree without them and extension list shows none', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const world = await cli.run('extension remove @agentage/fixture-world');
    expect(world.code).toBe(0);
    expect(world.lines).toContain(
      'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
    expect((await cli.run('extension remove @agentage/fixture-hello')).code).toBe(0);
    const tree = `extensions/trees/${cli.file('extensions/current')}`;
    expect(cli.list(`${tree}/node_modules/@agentage`)).toEqual([]);
    expect(cli.json('profile.json')['extensions']).toEqual({});
    expect(cli.list('state')).toEqual([]);
    expect((await cli.run('extension list')).lines).toEqual(['no extensions', '']);
  });

  test('agentage extension remove hello --purge without a terminal needs --yes; with --yes data/hello/ is gone', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(HELLO)}`);
    cli.write('data/hello/notes.json', { kept: true });
    const refused = await cli.run('extension remove hello --purge');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--purge without a terminal needs --yes');
    expect(cli.exists('data/hello/notes.json')).toBe(true);
    const purged = await cli.run('extension remove hello --purge --yes');
    expect(purged.code).toBe(0);
    expect(cli.exists('data/hello')).toBe(false);
    expect(cli.json('profile.json')['extensions']).toEqual({});
  });

  test('agentage extension remove hello after installing ./fixtures/extension-hello empties machine.json dev', async ({
    cli,
  }) => {
    expect((await cli.run('extension install ./fixtures/extension-hello')).code).toBe(0);
    const run = await cli.run('extension remove hello');
    expect(run.code).toBe(0);
    expect(cli.json('machine.json')['dev']).toEqual({});
    expect((await cli.run('extension list')).lines).toEqual(['no extensions', '']);
  });

  test('agentage extension remove nope exits 1: nope is not installed', async ({ cli }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const run = await cli.run('extension remove nope');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('nope is not installed');
  });
});
