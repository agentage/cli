/**
 * @offline - `agentage <command>` for a command an installed extension contributes: the CLI loads
 * that extension and its peers only, then runs the command the extension added.
 */
import { expect, test } from './cli.js';

const TWO = { extensions: { hello: '^1.0.0', world: '^1' } };

test.describe('agentage <extension command> @p0 @offline', () => {
  test('agentage hello prints "hello from hello" and loads only hello', async ({ cli }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    cli.remove('state');
    const run = await cli.run('hello');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('hello from hello');
    expect(cli.list('state')).toEqual(['hello.json']);
  });

  test('agentage world loads hello first, then prints what hello greeted', async ({ cli }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    cli.remove('state');
    const run = await cli.run('world');
    expect(run.code).toBe(0);
    expect(run.lines).toContain('world heard: hello from hello');
    expect(cli.list('state')).toEqual(['hello.json', 'world.json']);
  });

  test('agentage hello --help prints the help hello defines and exits 0', async ({ cli }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const help = await cli.run('hello --help');
    expect(help.code).toBe(0);
    expect(help.lines).toContain('Usage: agentage hello [options]');
    expect(help.lines).toContain('Print the greeting');
  });

  test('agentage nope exits 2, listing the core commands, then hello: hello and world: world', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const run = await cli.run('nope');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      [
        "error: unknown command 'nope'",
        'core: setup, status, update, extension',
        'hello: hello',
        'world: world',
      ].join('\n')
    );
  });

  test('agentage --version and agentage --help exit 0; --help lists hello under its extension id', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    expect((await cli.run('--version')).code).toBe(0);
    const help = await cli.run('--help');
    expect(help.code).toBe(0);
    const group = help.lines.indexOf('hello:');
    expect(group).toBeGreaterThan(-1);
    expect(help.lines[group + 1]).toMatch(/^ {2}hello +from the hello extension$/);
  });

  test('a broken hello manifest drops hello and world from the commands, and agentage status still exits 0', async ({
    cli,
  }) => {
    await cli.run(`setup --profile ${cli.profile(TWO)}`);
    const tree = `extensions/trees/${cli.file('extensions/current')}`;
    cli.write(`${tree}/node_modules/@agentage/fixture-hello/package.json`, '{ nope');
    expect((await cli.run('status')).code).toBe(0);
    const hello = await cli.run('hello');
    expect(hello.code).toBe(2);
    expect(hello.stderr).toContain("error: unknown command 'hello'");
  });
});
