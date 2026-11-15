import { describe, expect } from 'vitest';
import { noAccount } from '../../test/account.js';
import { fixture, MACHINE_ID, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { runJson } from '../../lib/json-output.js';
import { runExtensionRemove, type ConfirmIo, type ExtensionRemoveOptions } from './remove.js';

const HELLO_OK = 'hello  ok         @agentage/fixture-hello 1.0.0 (wants ^1.0.0)  commands: hello';

const noTerminal: ConfirmIo = {
  isTTY: false,
  prompt: async () => {
    throw new Error('asked without a terminal');
  },
};

// A terminal answering every question with `answer`; `asked` keeps the questions.
const terminal = (answer: string) => {
  const asked: string[] = [];
  const prompt = async (question: string): Promise<string> => {
    asked.push(question);
    return answer;
  };
  return { asked, io: { isTTY: true, prompt } };
};

const remove = (name: string, opts: Omit<ExtensionRemoveOptions, 'name'> = {}, io = noTerminal) =>
  output(() => runExtensionRemove({ name, ...opts }, { npm: npmFromFixtures, io, ...noAccount }));

// hello installed, with something in its data folder.
const installedHello = (dir: ConfigDir): void => {
  dir.profile({ extensions: { hello: '^1.0.0' } });
  dir.tree('hello');
  dir.write('data/hello/notes.json', { kept: true });
};

describe('agentage extension remove', () => {
  test('refuses while world peer-depends on hello, naming world, and changes nothing', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    dir.tree('hello', 'world');
    const before = dir.file('profile.json');
    const refused = await remove(pkg('hello'));
    expect(refused.error).toBe('@agentage/fixture-hello is needed by world; remove world first');
    expect(refused.code).toBe('needed_by_dependents');
    expect(dir.file('profile.json')).toBe(before);
  });

  test("by package name: out of profile.json and this machine's off list, its state file deleted, the rest installed again", async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' }, off: ['world'] });
    dir.tree('hello', 'world');
    dir.write('state/world.json', { at: '2026-10-29T10:00:00.000Z', pid: 7, state: 'ok' });
    const run = await remove(pkg('world'));
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'removed    @agentage/fixture-world',
      expect.stringMatching(/^install {4}1 extension in tree [0-9a-f]{16} \(npm install\)$/),
      HELLO_OK,
    ]);
    expect(dir.json('profile.json')).toMatchObject({
      extensions: { [pkg('hello')]: '^1.0.0' },
      machines: { [MACHINE_ID]: { off: [] } },
    });
    expect(dir.exists('state/world.json')).toBe(false);
  });

  test('by short name or by extension id', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0', '@agentage/extension-memory': '^1' } });
    dir.tree('hello');
    expect((await remove('memory')).lines[0]).toBe('removed    @agentage/extension-memory');
    expect((await remove('hello')).lines[0]).toBe('removed    @agentage/fixture-hello');
    expect(dir.json('profile.json')['extensions']).toEqual({});
  });

  test('a dev extension leaves machine.json dev, and an installed copy of the same package leaves the profile', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1.0.0' } });
    dir.tree('hello');
    dir.machine({ hello: fixture('hello') });
    expect((await remove('hello')).error).toBeNull();
    expect(dir.json('machine.json')['dev']).toEqual({});
    expect(dir.json('profile.json')['extensions']).toEqual({});
  });

  test('--purge on a terminal asks first; answering n removes hello but keeps data/hello/', async ({
    dir,
  }) => {
    installedHello(dir);
    const no = terminal('n');
    const run = await remove('hello', { purge: true }, no.io);
    expect(no.asked).toEqual([`delete ${dir.at('data/hello')} and everything in it? [y/N] `]);
    expect(run.lines[0]).toBe('removed    @agentage/fixture-hello');
    expect(dir.exists('data/hello/notes.json')).toBe(true);
  });

  test('--purge on a terminal answered y deletes data/hello/', async ({ dir }) => {
    installedHello(dir);
    const run = await remove('hello', { purge: true }, terminal('y').io);
    expect(run.lines.slice(0, 2)).toEqual([
      'removed    @agentage/fixture-hello',
      `purged     ${dir.at('data/hello')}`,
    ]);
    expect(dir.exists('data/hello')).toBe(false);
  });

  test('--purge without a terminal needs --yes and changes nothing; with --yes it deletes without asking', async ({
    dir,
  }) => {
    installedHello(dir);
    expect((await remove('hello', { purge: true })).error).toBe(
      `--purge without a terminal needs --yes (it deletes ${dir.at('data/hello')})`
    );
    expect(dir.json('profile.json')['extensions']).toEqual({ [pkg('hello')]: '^1.0.0' });
    expect((await remove('hello', { purge: true, yes: true })).error).toBeNull();
    expect(dir.exists('data/hello')).toBe(false);
  });

  test('--purge is refused when the extension id is unknown: it is not in the installed tree', async ({
    dir,
  }) => {
    dir.profile({ extensions: { '@agentage/extension-memory': '^1' } });
    expect((await remove('memory', { purge: true, yes: true })).error).toBe(
      '--purge needs the extension id of @agentage/extension-memory, which is not installed here'
    );
    expect(dir.json('profile.json')['extensions']).toEqual({ '@agentage/extension-memory': '^1' });
  });

  test('a name that is not installed fails saying so', async ({ dir }) => {
    installedHello(dir);
    const gone = await remove('nope');
    expect(gone.error).toBe('nope is not installed');
    expect(gone.code).toBe('not_installed');
  });

  test('--purge inside a --json run never asks, even on a terminal: confirmation_required', async ({
    dir,
  }) => {
    installedHello(dir);
    const out: string[] = [];
    const ask = terminal('y');
    const deps = { npm: npmFromFixtures, io: ask.io, ...noAccount };
    const failure = await runJson({ writeOut: (t) => void out.push(t) }, () =>
      runExtensionRemove({ name: 'hello', purge: true, json: true }, deps)
    );
    expect(failure).not.toBeNull();
    expect(JSON.parse(out.join('')).error.code).toBe('confirmation_required');
    expect(ask.asked).toEqual([]);
    expect(dir.file('data/hello/notes.json')).toContain('kept');
  });

  test('--json returns the rows the step loaded, not a second gather', async ({ dir }) => {
    dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
    dir.tree('hello', 'world');
    const deps = { npm: npmFromFixtures, io: noTerminal, ...noAccount };
    const quiet = await output(async () => {
      const result = (await runExtensionRemove({ name: pkg('world'), json: true }, deps)) as {
        extensions: { id: string }[];
      };
      expect(result.extensions.map((row) => row.id)).toEqual(['hello']);
    });
    expect(quiet.error).toBeNull();
  });

  test('not installed has the code not_installed', async ({ dir }) => {
    dir.profile({ extensions: {} });
    const out: string[] = [];
    await runJson({ writeOut: (t) => void out.push(t) }, () =>
      runExtensionRemove(
        { name: 'nope', json: true },
        { npm: npmFromFixtures, io: noTerminal, ...noAccount }
      )
    );
    expect(JSON.parse(out.join('')).error.code).toBe('not_installed');
  });
});
