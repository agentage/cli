import { describe, expect } from 'vitest';
import { fixture, output, pkg, plain, test } from '../../test/config-dir.js';
import { runExtensionList, summaryLines } from './list.js';
import { gatherExtensions } from './rows.js';

const AT = '2026-10-29T10:00:00.000Z';
const HELLO_DEV = 'hello  installed  @agentage/fixture-hello 1.0.0 (dev)  commands: hello';

const list = () => output(() => runExtensionList({}));

describe('agentage extension list', () => {
  test('shows the last run from state/<id>.json; a failed run quotes its error', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    dir.write('state/hello.json', { at: AT, pid: 7, state: 'failed', error: 'boom' });
    expect((await list()).lines).toEqual([
      `hello  installed  @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello  last run: failed "boom" at ${AT}`,
    ]);
  });

  test('never shows an invalid extension the last run of the id it claims', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1', 'dup-id': '^1' } });
    dir.tree('hello', 'dup-id');
    dir.write('state/hello.json', { at: AT, pid: 7, state: 'ok' });
    expect((await list()).lines).toEqual([
      'hello  invalid    @agentage/fixture-dup-id 1.0.0 (wants ^1)  duplicate id "hello" (also @agentage/fixture-hello)',
      'hello  invalid    @agentage/fixture-hello 1.0.0 (wants ^1)  commands: hello  duplicate id "hello" (also @agentage/fixture-dup-id)',
    ]);
  });

  test('lists a dev path from machine.json as a dev row', async ({ dir }) => {
    dir.machine({ hello: fixture('hello') });
    expect((await list()).lines).toEqual([HELLO_DEV]);
  });

  test('with an invalid profile.json still prints the rows, then fails naming each bad entry', async ({
    dir,
  }) => {
    dir.machine({ hello: fixture('hello') });
    dir.profile({ extensions: { world: 'file:../x' } });
    const run = await list();
    expect(run.lines).toEqual([HELLO_DEV]);
    expect(run.error).toBe(
      `profile.json is invalid:\n  extensions["${pkg('world')}"]: file: specs are refused; ` +
        'use a semver range or an https: tarball URL'
    );
  });

  test('with no extensions says so, and warns about keys profile.json does not know', async ({
    dir,
  }) => {
    dir.profile({ teams: ['a'] });
    expect(await list()).toMatchObject({
      lines: ['no extensions'],
      stderr: 'warning: profile.json: unknown key "teams" kept',
      error: null,
    });
  });
});

describe('agentage status', () => {
  test('adds this machine, the profile and the extension count, marking a newer profile read-only', async ({
    dir,
  }) => {
    dir.machine();
    dir.profile({ version: 2, extensions: { hello: '^1' } });
    expect(summaryLines((await gatherExtensions()).status).map(plain)).toEqual([
      'machine    m_0000beef (box)',
      'profile    version 2 (source: default, read-only)',
      'extensions 1',
    ]);
  });
});
