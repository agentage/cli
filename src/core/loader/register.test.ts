import { afterEach, describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { loadExtensions } from './load.js';
import { registerTimeoutMs } from './register.js';
import { scan, loadSet } from './scan.js';

const TIMEOUT = 'AGENTAGE_REGISTER_TIMEOUT_MS';

const loadAll = async () => loadExtensions(loadSet(scan(await loadMachine())));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('registering an extension', () => {
  afterEach(() => {
    delete process.env[TIMEOUT];
  });

  test('one that throws is failed with its message, and what it subscribed is disposed', async ({
    dir,
  }) => {
    const marker = JSON.stringify(dir.at('disposed'));
    dir.extension(
      'leaky',
      `import { writeFileSync } from 'node:fs';
export const register = (ctx) => {
  ctx.subscriptions.push({ dispose: () => writeFileSync(${marker}, '') });
  throw new Error('boom');
};`
    );
    const session = await loadAll();
    expect(session.outcomes.get('@test/leaky')).toEqual({ state: 'failed', error: 'boom' });
    expect(dir.exists('disposed')).toBe(true);
    await session.dispose();
  });

  test('one that never finishes is failed with "timeout" after AGENTAGE_REGISTER_TIMEOUT_MS', async ({
    dir,
  }) => {
    process.env[TIMEOUT] = '50';
    dir.profile({ extensions: { slow: '^1' } });
    dir.tree('slow');
    const session = await loadAll();
    expect(session.outcomes.get('@agentage/fixture-slow')).toEqual({
      state: 'failed',
      error: 'timeout',
    });
    await session.dispose();
  });

  test('a command added after the timeout is refused: its context was revoked', async ({ dir }) => {
    process.env[TIMEOUT] = '50';
    const marker = JSON.stringify(dir.at('late'));
    dir.extension(
      'late',
      `import { writeFileSync } from 'node:fs';
export const register = (ctx) => new Promise(() => setTimeout(() => {
  try { ctx.commands.add((program) => program.command('late')); }
  catch (err) { writeFileSync(${marker}, err.message); }
}, 100));`,
      { agentage: { contributes: { commands: ['late'] } } }
    );
    const session = await loadAll();
    await pause(150);
    expect(session.loaded.has('late')).toBe(false);
    expect(dir.file('late')).toBe('the context of extension late was revoked');
    await session.dispose();
  });

  test('an entry that exports no register function is failed, saying so', async ({ dir }) => {
    dir.extension('empty', 'export const other = 1;');
    const session = await loadAll();
    expect(session.outcomes.get('@test/empty')).toEqual({
      state: 'failed',
      error: 'the entry exports no register function',
    });
    await session.dispose();
  });

  test.for(['500', '0', '-1', '1.5', 'soon', ''])(
    'AGENTAGE_REGISTER_TIMEOUT_MS=%j: only a positive integer replaces the 10 s default',
    (value) => {
      process.env[TIMEOUT] = value;
      expect(registerTimeoutMs()).toBe(value === '500' ? 500 : 10_000);
    }
  );
});
