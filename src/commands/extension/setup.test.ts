import { rmSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { MACHINE_ID, npmFromFixtures, output, pkg, test } from '../../test/config-dir.js';
import { type SetupOptions } from '../auth/setup.js';
import { runExtensionSetup, type ExtensionSetupDeps } from './setup.js';

// Sign-in, sign-out and the status report reach the site: these stand-ins say what they did.
const deps: ExtensionSetupDeps = {
  ensureSignedIn: async () => {
    console.log('(signed in)');
    return 'already';
  },
  signOut: async () => console.log('(signed out)'),
  printStatus: async () => console.log('(status)'),
  npm: npmFromFixtures,
};

const setup = (opts: SetupOptions) => output(() => runExtensionSetup(opts, deps));

const npmAndTree = (lines: string[]) => lines.filter((l) => /^(npm|tree) /.test(l));

describe('agentage setup --profile', () => {
  test("keeps this machine's own off list from the local profile.json", async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' }, off: ['hello'] });
    const next = dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'next.json');
    const run = await setup({ profile: next });
    expect(run.error).toBeNull();
    expect(dir.json('profile.json')['machines']).toEqual({
      [MACHINE_ID]: { off: [pkg('hello')], config: {} },
    });
    expect(run.lines).toContain(
      'hello  off        @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello'
    );
  });

  test('refuses a file it cannot read or parse, and a URL, writing nothing', async ({ dir }) => {
    dir.write('junk.json', '{ nope');
    expect((await setup({ profile: dir.at('gone.json') })).error).toMatch(
      /^cannot read profile .*gone\.json: ENOENT/
    );
    expect((await setup({ profile: dir.at('junk.json') })).error).toBe(
      `${dir.at('junk.json')} is invalid:\n  not valid JSON`
    );
    expect((await setup({ profile: 'https://example.com/p.json' })).error).toBe(
      'https://example.com/p.json: profile URLs are not supported; pass a file path'
    );
    expect(dir.list('')).toEqual(['junk.json']);
  });

  test('--dry-run of a profile from a newer schema warns, prints the plan and writes nothing', async ({
    dir,
  }) => {
    const path = dir.profile({ version: 2, extensions: { hello: '^1.0.0' } }, 'v2.json');
    const run = await setup({ profile: path, dryRun: true });
    expect(run.stderr).toBe(
      'warning: version: 2 is newer than this CLI understands (1); read-only'
    );
    expect(run.lines).toEqual([
      'dry run    nothing written',
      `profile    ${path}`,
      'registry   default  https://registry.npmjs.org',
      `extensions ${dir.at('extensions')}`,
      'install    1 extension',
      '  @agentage/fixture-hello  ^1.0.0',
      'npm        install --ignore-scripts (no lock yet)',
      'tree       named from the lock npm writes',
    ]);
    expect(dir.list('')).toEqual(['v2.json']);
  });

  test('--dry-run names npm ci for a matching lock, npm install for a changed one, none for a built tree', async ({
    dir,
  }) => {
    const two = dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } }, 'two.json');
    expect((await setup({ profile: two })).error).toBeNull();
    const tree = `tree       ${dir.file('extensions/current')}`;
    const plan = async (path: string) =>
      npmAndTree((await setup({ profile: path, dryRun: true })).lines);
    expect(await plan(two)).toEqual(['npm        skipped, tree already installed', tree]);
    rmSync(dir.at('extensions/trees'), { recursive: true });
    expect(await plan(two)).toEqual([
      'npm        ci --ignore-scripts (the lock matches package.json)',
      tree,
    ]);
    expect(await plan(dir.profile({ extensions: { hello: '^1.0.0' } }, 'one.json'))).toEqual([
      'npm        install --ignore-scripts (the lock does not match package.json)',
      'tree       named from the lock npm writes',
    ]);
    expect(await plan(dir.profile({}, 'none.json'))).toEqual([
      'npm        skipped',
      expect.stringMatching(/^tree {7}[0-9a-f]{16}$/),
    ]);
  });

  test('--disconnect signs out and ignores --profile', async ({ dir }) => {
    expect((await setup({ disconnect: true, profile: dir.at('two.json') })).lines).toEqual([
      '(signed out)',
    ]);
  });
});

describe('agentage setup', () => {
  test('prints status after signing in, even when profile.json is invalid, then fails', async ({
    dir,
  }) => {
    dir.write('profile.json', { version: 0 });
    expect(await setup({})).toMatchObject({
      lines: ['(signed in)', '(status)'],
      error: 'profile.json is invalid:\n  version: must be 1 (got 0)',
    });
  });

  test('--dry-run plans from profile.json without signing in', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    const run = await setup({ dryRun: true });
    expect(run.lines).not.toContain('(signed in)');
    expect(run.lines).toContain('profile    profile.json');
    expect(run.lines).toContain('  @agentage/fixture-hello  ^1.0.0');
  });
});
