/**
 * @offline - `agentage extension doctor`: load every extension this machine can run once, rewrite
 * state/<id>.json, print the rows with ok or failed, exit 1 when any failed.
 */
import { expect, test } from './cli.js';

const HELLO_AND_THROWS = { extensions: { hello: '^1.0.0', throws: '^1' } };

const said = (stderr: string): string[] => stderr.split('\n').filter((line) => line !== '');

test.describe('agentage extension doctor @p0 @offline', () => {
  test('agentage extension doctor after a failed setup loads again, rewrites the state files and exits 1', async ({
    cli,
  }) => {
    expect((await cli.run(`setup --profile ${cli.profile(HELLO_AND_THROWS)}`)).code).toBe(1);
    const before = cli.json('state/throws.json');
    const check = await cli.run('extension doctor');
    expect(check.code).toBe(1);
    expect(check.lines.filter((line) => line !== '')).toEqual([
      'hello   ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello',
      'throws  failed     @agentage/fixture-throws 1.0.0 (wants ^1)  "boom"',
    ]);
    expect(said(check.stderr)).toEqual([
      'throws is about to throw',
      '1 extension failed to load: throws',
    ]);
    expect(cli.json('state/throws.json')['at']).not.toBe(before['at']);
  });

  test('agentage extension doctor --json keeps stdout valid JSON while throws prints during its load', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(HELLO_AND_THROWS)}`);
    const check = await cli.run('extension doctor --json');
    expect(check.code).toBe(1);
    const rows = JSON.parse(check.stdout).extensions as { id: string; state: string }[];
    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ['hello', 'ok'],
      ['throws', 'failed'],
    ]);
    expect(check.stderr).toContain('throws is about to throw');
  });
});
