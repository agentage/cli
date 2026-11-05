import { describe, expect, vi } from 'vitest';
import { fixture, output, pkg, test } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { loadExtensions } from './load.js';
import { scan, loadSet } from './scan.js';

const loadAll = async () => loadExtensions(loadSet(scan(await loadMachine())));

// The kit fixtures range over kit ^0.2, whatever kit is installed here.
vi.mock('../kit-version.js', () => ({ kitVersion: () => '0.2.0' }));

describe('loading the extensions this machine can run', () => {
  test('loads hello before world, and world gets what hello greets through use()', async ({
    dir,
  }) => {
    dir.profile({ extensions: { world: '^1', hello: '^1.0.0' } });
    dir.tree('hello', 'world');
    const session = await loadAll();
    expect([...session.loaded.keys()]).toEqual(['hello', 'world']);
    expect(session.loaded.get('world')?.facade['heard']?.()).toBe('hello from hello');
    await session.dispose();
  });

  test('writes state/<id>.json for each extension it ran, and none for an invalid or off one', async ({
    dir,
  }) => {
    dir.profile({
      extensions: { hello: '^1.0.0', 'old-engine': '^1', secret: '^1' },
      off: ['secret'],
    });
    dir.tree('hello', 'old-engine', 'secret');
    await (await loadAll()).dispose();
    expect(dir.list('state')).toEqual(['hello.json']);
    expect(dir.json('state/hello.json')).toMatchObject({
      pid: process.pid,
      state: 'ok',
      error: null,
    });
  });

  test('blocks a dependent of an extension that failed, naming that peer, and never imports it', async ({
    dir,
  }) => {
    const marker = JSON.stringify(dir.at('imported'));
    dir.profile({ extensions: { throws: '^1' } });
    dir.tree('throws');
    dir.extension(
      'needy',
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${marker}, '');\nexport const register = () => ({});`,
      { peerDependencies: { [pkg('throws')]: '^1' } }
    );
    const session = await output(async () => (await loadAll()).dispose());
    expect(session.error).toBeNull();
    expect(dir.json('state/needy.json')).toMatchObject({
      state: 'blocked',
      error: 'peer @agentage/fixture-throws is failed',
    });
    expect(dir.exists('imported')).toBe(false);
  });

  test('removes AGENTAGE_TOKEN from the environment before the first extension is imported', async ({
    dir,
  }) => {
    process.env['AGENTAGE_TOKEN'] = 'aga_unit';
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    await (await loadAll()).dispose();
    expect(process.env['AGENTAGE_TOKEN']).toBeUndefined();
    expect(JSON.parse(dir.file('logs/hello.log'))).toMatchObject({ token: false });
  });

  test('sends what an extension prints while loading to stderr', async ({ dir }) => {
    dir.profile({ extensions: { throws: '^1' } });
    dir.tree('throws');
    const run = await output(async () => (await loadAll()).dispose());
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('throws is about to throw');
  });

  test('holds SIGINT and SIGTERM to dispose the extensions first, until it is disposed', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const session = await loadAll();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(
      before.map((n) => n + 1)
    );
    await session.dispose();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });

  test('disposing runs each subscription once, however often it is called', async ({ dir }) => {
    const marker = JSON.stringify(dir.at('disposed'));
    dir.extension(
      'tidy',
      `import { appendFileSync } from 'node:fs';
export const register = (ctx) => { ctx.subscriptions.push({ dispose: () => appendFileSync(${marker}, 'x') }); };`
    );
    const session = await loadAll();
    await session.dispose();
    await session.dispose();
    expect(dir.file('disposed')).toBe('x');
  });

  test('a kit-shaped extension is checked by the kit, never imported: ok, or failed with why', async ({
    dir,
  }) => {
    dir.machine({ probe: fixture('probe'), pong: fixture('pong') });
    const set = loadSet(scan(await loadMachine()));
    const asked: string[] = [];
    const check = async (at: string) => {
      asked.push(at);
      return at.endsWith('pong') ? 'handlers ping, status; declared ping' : null;
    };
    const session = await loadExtensions(set, undefined, check);
    expect(asked).toEqual([fixture('probe'), fixture('pong')]);
    expect(Object.fromEntries(session.outcomes)).toEqual({
      [pkg('probe')]: { state: 'ok', error: null },
      [pkg('pong')]: { state: 'failed', error: 'handlers ping, status; declared ping' },
    });
    expect(session.loaded.size).toBe(0);
    expect(dir.json('state/pong.json')).toMatchObject({ state: 'failed' });
    await session.dispose();
  });

  test('a kit check that throws or hangs fails the extension; without a check it cannot pass', async ({
    dir,
  }) => {
    process.env['AGENTAGE_REGISTER_TIMEOUT_MS'] = '50';
    dir.machine({ probe: fixture('probe') });
    const set = loadSet(scan(await loadMachine()));
    const outcome = async (check?: (at: string) => Promise<string | null>) =>
      (await loadExtensions(set, undefined, check)).outcomes.get(pkg('probe'));
    expect(await outcome(async () => Promise.reject(new Error('no create')))).toEqual({
      state: 'failed',
      error: 'no create',
    });
    expect(await outcome(() => new Promise(() => undefined))).toEqual({
      state: 'failed',
      error: 'timeout',
    });
    expect((await outcome())?.state).toBe('failed');
    delete process.env['AGENTAGE_REGISTER_TIMEOUT_MS'];
  });

  test('a kit-shaped extension without a cli part has nothing to check and loads ok', async ({
    dir,
  }) => {
    const manifest = { engines: { agentage: '^0.2' }, agentage: { parts: { api: true } } };
    dir.extension('apionly', '', manifest);
    const session = await loadExtensions(loadSet(scan(await loadMachine())));
    expect(session.outcomes.get('@test/apionly')).toEqual({ state: 'ok', error: null });
  });
});
