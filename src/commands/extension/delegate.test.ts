import { afterEach, describe, expect } from 'vitest';
import { run, type ProgramDeps } from '../../program.js';
import { output, test, type ConfigDir } from '../../test/config-dir.js';

const notHere = async (): Promise<void> => {
  throw new Error('not part of these tests');
};

// `agentage <args>` through the real program: commander writes to out and err, extensions print.
const agentage = async (...args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: ProgramDeps = {
    setup: notHere,
    status: notHere,
    update: notHere,
    extensionInstall: notHere,
    extensionRemove: notHere,
    extensionList: notHere,
    extensionDoctor: notHere,
    extensionCheck: notHere,
    extensionCreate: notHere,
    extensionBuild: notHere,
    extensionRelease: notHere,
    extensionUp: notHere,
    extensionDown: notHere,
    extensionToken: notHere,
    kitTool: notHere as unknown as ProgramDeps['kitTool'],
    updateHint: () => null,
    refreshUpdateCache: async () => undefined,
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
  };
  let code = -1;
  const printed = await output(async () => {
    code = await run(['node', 'agentage', ...args], deps);
  });
  return { code, out: out.join(''), err: err.join(''), lines: printed.lines };
};

const helloAndWorld = (dir: ConfigDir): void => {
  dir.profile({ extensions: { hello: '^1.0.0', world: '^1' } });
  dir.tree('hello', 'world');
};

// A dev extension contributing the command `<id>` with this register body.
const contributing = (dir: ConfigDir, id: string, register: string): void =>
  void dir.extension(id, `export const register = (ctx) => { ${register} };`, {
    agentage: { contributes: { commands: [id] } },
  });

describe('agentage <extension command>', () => {
  afterEach(() => {
    delete process.env['AGENTAGE_EXTENSIONS'];
  });

  test('agentage hello runs the command hello adds, loading hello only', async ({ dir }) => {
    helloAndWorld(dir);
    expect(await agentage('hello')).toMatchObject({ code: 0, lines: ['hello from hello'] });
    expect(dir.list('state')).toEqual(['hello.json']);
  });

  test('agentage hello --help prints the help hello defines and exits 0', async ({ dir }) => {
    helloAndWorld(dir);
    const help = await agentage('hello', '--help');
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage: agentage hello [options]\n\nPrint the greeting');
  });

  test("agentage nope exits 2, listing the core commands, then each extension's", async ({
    dir,
  }) => {
    helloAndWorld(dir);
    const nope = await agentage('nope');
    expect(nope.code).toBe(2);
    expect(nope.err).toBe(
      "error: unknown command 'nope'\ncore: setup, status, update, extension\nhello: hello\nworld: world\n"
    );
  });

  test("agentage --help groups each extension's commands under its id", async ({ dir }) => {
    helloAndWorld(dir);
    const help = await agentage('--help');
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/\nhello:\n {2}hello +from the hello extension\n/);
    expect(help.out).toMatch(/\nworld:\n {2}world +from the world extension\n/);
  });

  test('a command an extension lists but never adds fails naming it, exit 1', async ({ dir }) => {
    contributing(dir, 'ghost', 'return {};');
    const ghost = await agentage('ghost');
    expect(ghost.code).toBe(1);
    expect(ghost.err).toBe('extension ghost did not add the command ghost\n');
  });

  test('a command whose extension fails to load fails with the reason, exit 1', async ({ dir }) => {
    contributing(dir, 'broken', "throw new Error('no config');");
    const broken = await agentage('broken');
    expect(broken.code).toBe(1);
    expect(broken.err).toBe('extension broken failed: no config\n');
  });

  test('an error the command itself throws exits 1 with its message', async ({ dir }) => {
    contributing(
      dir,
      'fails',
      "ctx.commands.add((p) => p.command('fails').action(() => { throw new Error('nope'); }));"
    );
    const fails = await agentage('fails');
    expect(fails.code).toBe(1);
    expect(fails.err).toBe('nope\n');
  });

  test('AGENTAGE_EXTENSIONS is ignored: set to 0, agentage hello still runs', async ({ dir }) => {
    process.env['AGENTAGE_EXTENSIONS'] = '0';
    helloAndWorld(dir);
    expect(await agentage('hello')).toMatchObject({ code: 0, lines: ['hello from hello'] });
  });
});
