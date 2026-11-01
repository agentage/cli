import { Command } from 'commander';
import { describe, expect } from 'vitest';
import { fixture, test, type ConfigDir } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { createContext } from './ctx.js';
import { scan, loadSet } from './scan.js';
import { createUse } from './use.js';

// The context the loader would hand hello, before its register runs.
const stage = async (dir: ConfigDir, dev = false) => {
  if (dev) dir.machine({ hello: fixture('hello') });
  else {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
  }
  const [hello] = loadSet(scan(await loadMachine()));
  if (!hello) throw new Error('hello did not discover');
  return createContext({ ext: hello, use: createUse(hello, new Map()), template: new Command() });
};

describe("an extension's context", () => {
  test('has exactly the documented members', async ({ dir }) => {
    const { ctx } = await stage(dir);
    expect(Object.keys(ctx)).toEqual([
      'id',
      'version',
      'mode',
      'config',
      'secrets',
      'data',
      'cache',
      'log',
      'commands',
      'use',
      'subscriptions',
    ]);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  test('knows its extension: id, version, mode, config with defaults, and its own folders', async ({
    dir,
  }) => {
    const { ctx } = await stage(dir);
    expect(ctx).toMatchObject({ id: 'hello', version: '1.0.0', mode: 'installed' });
    expect(ctx.config).toEqual({ greeting: 'hello' });
    expect(ctx.data).toBe(dir.at('data/hello'));
    expect(ctx.cache).toBe(dir.at('cache/hello'));
    expect((await stage(dir, true)).ctx.mode).toBe('dev');
  });

  test('once revoked, every method throws', async ({ dir }) => {
    const { ctx, revoke } = await stage(dir);
    revoke();
    const calls = [
      () => ctx.secrets.get('token'),
      () => ctx.secrets.set('token', 'x'),
      () => ctx.secrets.delete('token'),
      () => ctx.log('late'),
      () => ctx.commands.add(() => undefined),
      () => ctx.use('world'),
      () => ctx.subscriptions.push({ dispose: () => undefined }),
    ];
    for (const call of calls) expect(call).toThrow('the context of extension hello was revoked');
  });

  test('commands.add runs each registrar on a Command of its own, refusing a name not in contributes.commands', async ({
    dir,
  }) => {
    const { ctx, program } = await stage(dir);
    ctx.commands.add((p) => p.command('hello'));
    expect(program.commands.map((c) => c.name())).toEqual(['hello']);
    expect(() => ctx.commands.add((p) => p.command('hello:other'))).toThrow(
      'command "hello:other" is not in agentage.contributes.commands'
    );
  });

  test('subscriptions.push stages what the core disposes later', async ({ dir }) => {
    const { ctx, subscriptions } = await stage(dir);
    const watcher = { dispose: () => undefined };
    ctx.subscriptions.push(watcher);
    expect(subscriptions).toEqual([watcher]);
  });
});
