import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createTestContext } from './extension-test.js';

// The members docs/reference.md documents for ctx, in order.
const MEMBERS = [
  'id',
  'version',
  'previousVersion',
  'mode',
  'config',
  'secrets',
  'data',
  'cache',
  'log',
  'commands',
  'use',
  'subscriptions',
];

describe("createTestContext, for an extension author's own tests", () => {
  it("yields a frozen ctx in mode 'test' with exactly the documented members", () => {
    const ctx = createTestContext();
    expect(Object.keys(ctx)).toEqual(MEMBERS);
    expect(ctx).toMatchObject({
      id: 'test',
      version: '0.0.0',
      previousVersion: null,
      mode: 'test',
    });
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('keeps data and cache in a temp dir of its own, and takes overrides', () => {
    const ctx = createTestContext({
      id: 'hello',
      config: { greeting: 'hi' },
      previousVersion: '1.0.0',
    });
    expect(ctx).toMatchObject({
      id: 'hello',
      config: { greeting: 'hi' },
      previousVersion: '1.0.0',
    });
    expect(Object.isFrozen(ctx.config)).toBe(true);
    expect(ctx.data.endsWith('data/hello')).toBe(true);
    expect(dirname(dirname(ctx.cache))).toBe(dirname(dirname(ctx.data)));
    expect(existsSync(dirname(dirname(ctx.data)))).toBe(true);
  });

  it('hands use(id) the fake for that id; another id throws unless optional', () => {
    const hello = { greet: () => 'hi' };
    const ctx = createTestContext({ use: { hello } });
    expect(ctx.use('hello')).toBe(hello);
    expect(ctx.use('world', { optional: true })).toBeUndefined();
    expect(() => ctx.use('world')).toThrow('use("world"): no fake for it');
  });

  it('adds commands to the program it is given, and keeps secrets in memory', async () => {
    const program = new Command('agentage').exitOverride();
    const ctx = createTestContext({ program });
    let ran = false;
    ctx.commands.add((p) => p.command('hello').action(() => void (ran = true)));
    await program.parseAsync(['hello'], { from: 'user' });
    expect(ran).toBe(true);
    await ctx.secrets.set('token', 't');
    expect(await ctx.secrets.get('token')).toBe('t');
    await ctx.secrets.delete('token');
    expect(await ctx.secrets.get('token')).toBeUndefined();
    ctx.log('quiet');
    ctx.subscriptions.push({ dispose: () => undefined });
  });
});
