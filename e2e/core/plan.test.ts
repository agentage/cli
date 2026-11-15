/**
 * @offline - the plan: what `setup` would send to the daemon. `setup --dry-run` prints it,
 * `setup --check` exits 1 when anything would be installed; both read `profile.json` and
 * `installation.json` only. `status` still shows the drift of a 0.51 tree.
 */
import { expect, test, type Machine } from './cli.js';

const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };
const HELLO = '@agentage/fixture-hello';
const A = '@agentage/extension-alpha';
const B = '@agentage/extension-beta';

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

// A machine whose profile names alpha and beta; alpha is in installation.json already.
const halfInstalled = async (cli: Machine): Promise<void> => {
  expect((await cli.run('status')).code).toBe(0);
  cli.write('profile.json', { version: 1, extensions: { [A]: '^1', [B]: '2.0.0' } });
  cli.write('installation.json', {
    host: 'local',
    extensions: [{ id: 'alpha', version: '1.0.0' }],
  });
};

test.describe('agentage setup --dry-run @p0 @offline', () => {
  test('agentage setup --dry-run prints what setup would install and what is installed already, writing nothing', async ({
    cli,
  }) => {
    await halfInstalled(cli);
    const before = cli.snapshot();
    const run = await cli.run('setup --dry-run');
    expect(run.code).toBe(0);
    expect(run.lines.slice(-3)).toEqual([
      `+ add ${B} 2.0.0`,
      'plan: 1 to add, 0 off, 1 already installed',
      '',
    ]);
    expect(cli.snapshot()).toEqual(before);
  });
});

test.describe('agentage status shows the drift @p0 @offline', () => {
  test('after world is taken out of profile.json by hand, status says "extensions 2 (1 to remove)"', async ({
    cli,
  }) => {
    await cli.oldSetup(TWO);
    handEdit(cli, { [HELLO]: '^1.0.0' });
    expect((await cli.run('status')).lines).toContain('extensions 2 (1 to remove)');
  });
});

test.describe('agentage setup --check @p0 @offline', () => {
  test('agentage setup --check with an entry not installed exits 1, printing the plan and writing nothing', async ({
    cli,
  }) => {
    await halfInstalled(cli);
    const before = cli.snapshot();
    const run = await cli.run('setup --check');
    expect(run.code).toBe(1);
    expect(run.lines).toEqual([
      `+ add ${B} 2.0.0`,
      'plan: 1 to add, 0 off, 1 already installed',
      '',
    ]);
    expect(run.stderr).toContain('not converged: 1 to add');
    expect(cli.snapshot()).toEqual(before);
  });

  test('agentage setup --check once every entry is installed prints "plan: nothing to change" and exits 0', async ({
    cli,
  }) => {
    await halfInstalled(cli);
    cli.write('installation.json', {
      host: 'local',
      extensions: [
        { id: 'alpha', version: '1.0.0' },
        { id: 'beta', version: '2.0.0' },
      ],
    });
    const run = await cli.run('setup --check');
    expect(run.code).toBe(0);
    expect(run.lines).toEqual(['plan: nothing to change', '']);
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
  test("after a hand edit of hello's integrity in the lock, extension doctor exits 1", async ({
    cli,
  }) => {
    await cli.oldSetup(TWO);
    tamper(cli);
    expect((await cli.run('extension doctor')).code).toBe(1);
  });
});
