import { describe, expect } from 'vitest';
import { output, pkg, test } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { loadExtensions } from './load.js';
import { scan, loadSet } from './scan.js';

const loadAll = async () => loadExtensions(loadSet(scan(await loadMachine())));

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
});
