/**
 * @offline - the plan with AGENTAGE_EXTENSIONS=1: what `setup` would change to bring this machine
 * (the installed tree) to its profile. `setup --dry-run` prints it, `setup --check` verifies it and
 * exits 1 when anything would change, `extension list` and `status` show the drift.
 */
import { expect, test, type Machine } from './cli.js';

const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };
const HELLO = '@agentage/fixture-hello';
const TWO_PACKAGES = { [HELLO]: '^1.0.0', '@agentage/fixture-world': '^1' };

// profile.json edited by hand: `extensions` replaced, everything else kept.
const handEdit = (cli: Machine, extensions: Record<string, string>): void =>
  cli.write('profile.json', { ...cli.json('profile.json'), extensions });

// extensions/package-lock.json edited by hand: hello's integrity replaced.
const tamper = (cli: Machine): void => {
  const lock = cli.json('extensions/package-lock.json') as { packages: Record<string, object> };
  const entry = `node_modules/${HELLO}`;
  lock.packages[entry] = { ...lock.packages[entry], integrity: 'sha512-tampered' };
  cli.write('extensions/package-lock.json', lock);
};

test.describe('agentage setup --dry-run @p0 @offline', () => {
  test('agentage setup --dry-run with the profile just installed prints "plan: nothing to change"', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile(TWO)}`)).code).toBe(0);
    const run = await cli.run(`setup --profile ${cli.profile(TWO)} --dry-run`);
    expect(run.code).toBe(0);
    expect(run.lines.slice(-2)).toEqual(['plan: nothing to change', '']);
  });

  test('agentage setup --dry-run with a profile that drops world and adds secret prints - remove, + add and the summary, writing nothing', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const before = cli.snapshot();
    const swapped = cli.profile({ extensions: { hello: '^1.0.0', secret: '^1' } });
    const run = await cli.run(`setup --profile ${swapped} --dry-run`);
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([
      'dry run    nothing written',
      `registry   @agentage  ${cli.registry}`,
      'registry   default    https://registry.npmjs.org',
      '+ add @agentage/fixture-secret ^1',
      '- remove @agentage/fixture-world',
      'plan: 1 to add, 0 to update, 1 to remove, 0 off, 1 unchanged',
      '',
    ]);
    expect(cli.snapshot()).toEqual(before);
  });
});

test.describe('agentage extension list and status show the drift @p0 @offline', () => {
  test('after world is taken out of profile.json by hand, agentage extension list shows world to remove and status says "extensions 2 (1 to remove)"', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    handEdit(cli, { [HELLO]: '^1.0.0' });
    const list = await cli.run('extension list');
    expect(list.lines).toContainEqual(
      expect.stringMatching(
        /^world {2}installed {2}remove {2}@agentage\/fixture-world 1\.0\.0 \(not in profile\)/
      )
    );
    const json = JSON.parse((await cli.run('extension list --json')).stdout);
    expect(json.plan).toEqual({ add: 0, update: 0, remove: 1, off: 0, unchanged: 1 });
    expect((await cli.run('status')).lines).toContain('extensions 2 (1 to remove)');
  });
});

test.describe('agentage setup --check @p0 @offline', () => {
  test('agentage setup --check on a converged machine prints "plan: nothing to change", exits 0 and writes nothing', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const before = cli.snapshot();
    const run = await cli.run('setup --check');
    expect(run.code).toBe(0);
    expect(run.lines).toEqual(['plan: nothing to change', '']);
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage setup --check after secret is added to profile.json by hand exits 1, printing the plan and writing nothing', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    handEdit(cli, { ...TWO_PACKAGES, '@agentage/fixture-secret': '^1' });
    const before = cli.snapshot();
    const run = await cli.run('setup --check');
    expect(run.code).toBe(1);
    expect(run.lines).toEqual([
      '+ add @agentage/fixture-secret ^1',
      'plan: 1 to add, 0 to update, 0 to remove, 0 off, 2 unchanged',
      '',
    ]);
    expect(run.stderr).toContain('not converged: 1 to add');
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage setup --check after a hand edit of hello\'s integrity in the lock exits 1 with "integrity drift"', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    tamper(cli);
    const run = await cli.run('setup --check');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`integrity drift: ${HELLO}@1.0.0`);
  });

  test('agentage setup --check on a new machine reports "machine.json: missing", exits 1 and creates nothing', async ({
    cli,
  }) => {
    const run = await cli.run('setup --check');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('machine.json: missing');
    expect(cli.list('').filter((name) => name !== 'update-check.json')).toEqual([]);
  });
});

test.describe('integrity drift @p0 @offline', () => {
  test("after a hand edit of hello's integrity in the lock, extension list shows hello invalid, and setup --profile and extension check exit 1", async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    tamper(cli);
    expect((await cli.run('extension list')).lines).toContainEqual(
      expect.stringMatching(
        /^hello {2}invalid .* integrity drift: @agentage\/fixture-hello@1\.0\.0$/
      )
    );
    const setup = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect(setup.code).toBe(1);
    expect(setup.stderr).toContain(`Setup failed: integrity drift: ${HELLO}@1.0.0`);
    expect((await cli.run('extension check')).code).toBe(1);
  });
});
