import { describe, expect, vi } from 'vitest';
import { install } from '../../core/installer/installer.js';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { CHECK_DEPRECATED, deprecatedCheck, runExtensionDoctor } from './doctor.js';
import { type KitTool } from './kit-tool.js';

// The kit fixtures range over kit ^0.2, whatever kit is installed here.
vi.mock('../../core/kit-version.js', () => ({ kitVersion: () => '0.2.0' }));

const check = (json = false) => output(() => runExtensionDoctor({ json }));

// The kit's checkCli as a seam: a problem per folder, null for the rest.
const kitChecking = (problems: Record<string, string> = {}) => {
  const asked: string[] = [];
  const checkCli = async (dir: string) => {
    asked.push(dir);
    return problems[dir] ?? null;
  };
  return { tool: async () => ({ checkCli }) as unknown as KitTool, asked };
};

const helloAndThrows = (dir: ConfigDir): void => {
  dir.profile({ extensions: { hello: '^1.0.0', throws: '^1' } });
  dir.tree('hello', 'throws');
};

describe('agentage extension doctor', () => {
  test('loads every extension once, prints ok and failed rows, and fails naming the failed', async ({
    dir,
  }) => {
    helloAndThrows(dir);
    const run = await check();
    expect(run.lines).toEqual([
      'hello   ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
      'throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"',
    ]);
    expect(run.error).toBe('1 extension failed to load: throws');
    expect(dir.json('state/throws.json')).toMatchObject({ state: 'failed', error: 'boom' });
  });

  test('--json prints the rows as JSON on stdout, and what extensions print while loading on stderr', async ({
    dir,
  }) => {
    helloAndThrows(dir);
    const run = await check(true);
    const { extensions } = JSON.parse(run.stdout) as { extensions: Record<string, unknown>[] };
    expect(extensions.map((row) => [row['id'], row['state'], row['error']])).toEqual([
      ['hello', 'ok', null],
      ['throws', 'failed', 'boom'],
    ]);
    expect(run.stderr).toBe('throws is about to throw');
  });

  test('blocks world when hello fails to load, naming hello', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    const tree = dir.tree('hello', 'world');
    dir.write(`${tree}/node_modules/@agentage/fixture-hello/index.js`, 'throw new Error("gone");');
    const run = await check();
    expect(run.lines).toEqual([
      'hello  failed     @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  "gone"',
      'world  blocked    @agentage/fixture-world 1.0.0 (wants ^1)  commands: world  peer @agentage/fixture-hello is failed',
    ]);
  });

  test('fails on integrity drift, loading nothing whose bytes the two locks disagree on', async ({
    dir,
  }) => {
    const hello = { [pkg('hello')]: '^1.0.0' };
    dir.profile({ extensions: hello });
    await install({ extensions: hello, registries: {} }, npmFromFixtures);
    const lock = dir.json('extensions/package-lock.json') as { packages: Record<string, object> };
    lock.packages[`node_modules/${pkg('hello')}`] = { version: '1.0.0', integrity: 'sha512-x' };
    dir.write('extensions/package-lock.json', lock);
    const run = await check();
    expect(run.lines).toEqual([
      'hello  invalid    @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  integrity drift: @agentage/fixture-hello@1.0.0',
    ]);
    expect(run.error).toBe('integrity drift: @agentage/fixture-hello@1.0.0');
    expect(dir.exists('state/hello.json')).toBe(false);
  });

  test('with no extensions says so and passes', async () => {
    expect(await check()).toMatchObject({ lines: ['no extensions'], error: null });
  });

  test('a kit-built extension is ok when the kit finds create and the declared handlers', async ({
    dir,
  }) => {
    dir.machine({ probe: fixture('probe') });
    const { tool, asked } = kitChecking();
    const run = await output(() => runExtensionDoctor({}, tool));
    expect(run.lines).toEqual([
      'probe  ok         @agentage/fixture-probe 0.2.0 (dev)  commands: ping',
    ]);
    expect(asked).toEqual([fixture('probe')]);
    expect(run.error).toBeNull();
  });

  test('a kit-built extension whose handlers differ from its commands fails with the reason', async ({
    dir,
  }) => {
    dir.machine({ pong: fixture('pong') });
    const { tool } = kitChecking({ [fixture('pong')]: 'status is declared but has no handler' });
    const run = await output(() => runExtensionDoctor({}, tool));
    expect(run.lines).toEqual([
      'pong  failed     @agentage/fixture-pong 0.2.0 (dev)  commands: ping, pong status  "status is declared but has no handler"',
    ]);
    expect(run.error).toBe('1 extension failed to load: pong');
    expect(dir.json('state/pong.json')).toMatchObject({ state: 'failed' });
  });
});

describe('agentage extension check, the old name of doctor for 90 days', () => {
  test('prints one deprecation line on stderr naming doctor, then runs doctor', async () => {
    const err: string[] = [];
    const ran: unknown[] = [];
    const doctor = async (opts: unknown) => void ran.push(opts);
    await deprecatedCheck(doctor, (text) => void err.push(text))({ json: true });
    expect(err).toHaveLength(1);
    expect(err[0]).toContain(`warning: ${CHECK_DEPRECATED}`);
    expect(CHECK_DEPRECATED).toContain('agentage extension doctor');
    expect(CHECK_DEPRECATED).toContain('check becomes the conformance check');
    expect(ran).toEqual([{ json: true }]);
  });
});
