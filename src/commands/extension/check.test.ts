import { describe, expect } from 'vitest';
import { output, test, type ConfigDir } from '../../test/config-dir.js';
import { runExtensionCheck } from './check.js';

const check = (json = false) => output(() => runExtensionCheck({ json }));

const helloAndThrows = (dir: ConfigDir): void => {
  dir.profile({ extensions: { hello: '^1.0.0', throws: '^1' } });
  dir.tree('hello', 'throws');
};

describe('agentage extension check', () => {
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

  test('with no extensions says so and passes', async () => {
    expect(await check()).toMatchObject({ lines: ['no extensions'], error: null });
  });
});
