/**
 * @offline - `agentage extension check`: load every extension this machine can run once, rewrite
 * state/<id>.json, print the rows with ok or failed, exit 1 when any failed.
 */
import { expect, test } from './cli.js';

const HELLO_AND_THROWS = { extensions: { hello: '^1.0.0', throws: '^1' } };

test.describe('agentage extension check @p0 @offline', () => {
  test('agentage extension check after a failed setup loads again, rewrites the state files and exits 1', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile(HELLO_AND_THROWS)}`)).code).toBe(1);
    const before = cli.json('state/throws.json');
    const check = await cli.run('extension check');
    expect(check.code).toBe(1);
    expect(check.lines).toContain(
      'hello   ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
    expect(check.lines).toContain(
      'throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"'
    );
    expect(check.stderr).toContain('1 extension failed to load: throws');
    expect(cli.json('state/throws.json')['at']).not.toBe(before['at']);
  });

  test('agentage extension check --json keeps stdout valid JSON while throws prints during its load', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(HELLO_AND_THROWS)}`);
    const check = await cli.run('extension check --json');
    expect(check.code).toBe(1);
    const rows = JSON.parse(check.stdout).extensions as { id: string; state: string }[];
    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ['hello', 'ok'],
      ['throws', 'failed'],
    ]);
    expect(check.stderr).toContain('throws is about to throw');
  });
});
