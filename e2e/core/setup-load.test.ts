/**
 * @offline - `agentage setup` with AGENTAGE_EXTENSIONS=1, after installing: secrets to set are
 * listed, every extension is loaded once, and the rows show ok, failed, invalid or blocked.
 */
import { expect, test } from './cli.js';

const HELLO = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';
const WORLD = 'world  ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world';
const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage setup --profile loads the extensions @p0 @offline', () => {
  test('agentage setup --profile with hello and world loads both and writes their state files', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect(run.code).toBe(0);
    expect(run.lines).toContain(HELLO);
    expect(run.lines).toContain(WORLD);
    expect(cli.list('state')).toEqual(['hello.json', 'world.json']);
    expect(cli.json('state/world.json')).toMatchObject({ state: 'ok', error: null });
  });

  test('agentage setup --profile prints hello ok, oldengine invalid, throws failed "boom", slow failed "timeout", and exits 1', async ({
    cli,
  }) => {
    const all = { hello: '^1.0.0', world: '^1', 'old-engine': '^1.0.0', throws: '^1', slow: '^1' };
    const profile = cli.profile({ extensions: all });
    const run = await cli.run(`setup --profile ${profile}`, {
      AGENTAGE_REGISTER_TIMEOUT_MS: '500',
    });
    expect(run.code).toBe(1);
    expect(run.lines).toEqual(
      expect.arrayContaining([
        'hello      ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
        'world      ok         @agentage/fixture-world 1.0.0 (wants ^1)  commands: world',
        'oldengine  invalid    @agentage/fixture-old-engine 1.0.0 (wants ^1.0.0)  engines.agentage "^0.1" does not match extension API 1.0.0',
        'throws     failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"',
        'slow       failed     @agentage/fixture-slow 1.0.0 (wants ^1)  "timeout"',
      ])
    );
    expect(run.stderr).toContain('Setup failed: 2 extensions failed to load: slow, throws');
    expect(cli.json('state/throws.json')).toMatchObject({ state: 'failed', error: 'boom' });
  });

  test('agentage setup --profile lists "secrets to set: secret.token" before loading, and asks nothing without a terminal', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile({ extensions: { secret: '^1' } })}`);
    expect(run.code).toBe(0);
    const listed = run.lines.indexOf('secrets to set: secret.token');
    expect(listed).toBeGreaterThan(-1);
    expect(listed).toBeLessThan(run.lines.findIndex((line) => line.startsWith('secret  ok')));
    expect(cli.exists('secrets.json')).toBe(false);
  });

  test('agentage setup --profile with AGENTAGE_TOKEN set loads hello without the token in its environment', async ({
    cli,
  }) => {
    const run = await cli.run(`setup --profile ${cli.profile(TWO)}`, { AGENTAGE_TOKEN: 'aga_e2e' });
    expect(run.code).toBe(0);
    const [registered] = cli.file('logs/hello.log').split('\n');
    expect(JSON.parse(registered ?? '')).toMatchObject({
      message: 'registered',
      greeting: 'hello from hello',
      token: false,
    });
  });
});
