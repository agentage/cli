import { type RunCommandOptions } from '@agentage/extension/tool';
import { afterEach, describe, expect, vi } from 'vitest';
import { run, type ProgramDeps } from '../../program.js';
import { fixture, output, pkg, test, type ConfigDir } from '../../test/config-dir.js';
import { type KitTool } from './kit-tool.js';

// The kit fixtures range over kit ^0.2, whatever kit is installed here.
vi.mock('../../core/kit-version.js', () => ({ kitVersion: () => '0.2.0' }));

const notHere = async (): Promise<void> => {
  throw new Error('not part of these tests');
};

// The kit's runCommand as a seam: what it got, an answer like the fixtures', the code to return.
const fakeKit = (code = 0) => {
  const runs: Omit<RunCommandOptions, 'stdout' | 'stderr'>[] = [];
  const runCommand = async ({ dir, command, argv }: RunCommandOptions) => {
    runs.push({ dir, command, argv });
    console.log(`${command} ${argv.join(' ')}`.trim());
    return code;
  };
  return { tool: async () => ({ runCommand }) as unknown as KitTool, runs };
};

// `agentage <args>` through the real program, with the kit tool given.
const agentage = async (kit: Pick<ProgramDeps, 'kitTool'>, ...args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: ProgramDeps = {
    setup: notHere,
    status: async () => console.log('core status'),
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
    updateHint: () => null,
    refreshUpdateCache: async () => undefined,
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
    ...kit,
  };
  let code = -1;
  const printed = await output(async () => {
    code = await run(['node', 'agentage', ...args], deps);
  });
  return { code, out: out.join(''), err: err.join(''), lines: printed.lines };
};

const probe = (dir: ConfigDir): void => dir.machine({ probe: fixture('probe') });
const probeAndPong = (dir: ConfigDir): void =>
  dir.machine({ probe: fixture('probe'), pong: fixture('pong') });

describe('the commands of a kit-built extension', () => {
  afterEach(() => {
    delete process.env['AGENTAGE_TOKEN'];
  });

  test('agentage ping runs the kit command ping in the extension folder', async ({ dir }) => {
    probe(dir);
    const kit = fakeKit();
    expect(await agentage({ kitTool: kit.tool }, 'ping')).toMatchObject({
      code: 0,
      lines: ['ping'],
    });
    expect(kit.runs).toEqual([{ dir: fixture('probe'), command: 'ping', argv: [] }]);
  });

  test('agentage ping hi and agentage probe ping hi --json hand the args to the kit untouched', async ({
    dir,
  }) => {
    probe(dir);
    const kit = fakeKit();
    expect((await agentage({ kitTool: kit.tool }, 'ping', 'hi')).lines).toEqual(['ping hi']);
    await agentage({ kitTool: kit.tool }, 'probe', 'ping', 'hi', '--json');
    await agentage({ kitTool: kit.tool }, 'ping', '--help');
    expect(kit.runs.map((r) => r.argv)).toEqual([['hi'], ['hi', '--json'], ['--help']]);
  });

  test("the kit's exit code is the cli's: 2 for usage, 1 for a failure, nothing added", async ({
    dir,
  }) => {
    probe(dir);
    for (const code of [2, 1]) {
      const ran = await agentage({ kitTool: fakeKit(code).tool }, 'ping', 'a', 'b');
      expect(ran).toMatchObject({ code, err: '' });
    }
  });

  test('a kit that cannot run the command exits 1 with its message', async ({ dir }) => {
    probe(dir);
    const kitTool = async () => ({ runCommand: () => notHere() }) as unknown as KitTool;
    expect(await agentage({ kitTool }, 'ping')).toMatchObject({
      code: 1,
      err: 'not part of these tests\n',
    });
  });

  test('the account token never reaches the kit command', async ({ dir }) => {
    probe(dir);
    process.env['AGENTAGE_TOKEN'] = 'aga_x';
    let seen: string | undefined = 'unset';
    const runCommand = async () => {
      seen = process.env['AGENTAGE_TOKEN'];
      return 0;
    };
    await agentage({ kitTool: async () => ({ runCommand }) as unknown as KitTool }, 'ping');
    expect(seen).toBeUndefined();
  });

  test('agentage probe --help lists the commands from the manifest without asking the kit', async ({
    dir,
  }) => {
    probe(dir);
    const kitTool = vi.fn(fakeKit().tool);
    const help = await agentage({ kitTool }, 'probe', '--help');
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/Usage: agentage probe \[options\] \[command\]/);
    expect(help.out).toMatch(/\n {2}ping +answer pong\n/);
    expect(kitTool).not.toHaveBeenCalled();
    expect(await agentage({ kitTool }, 'probe')).toMatchObject({ code: 0, out: help.out });
    expect(await agentage({ kitTool }, 'probe', 'nope')).toMatchObject({
      code: 2,
      err: "error: unknown command 'nope'\n",
    });
  });

  test('agentage --help lists ping and the probe group under probe:', async ({ dir }) => {
    probe(dir);
    const help = await agentage({ kitTool: fakeKit().tool }, '--help');
    expect(help.out).toMatch(
      /\nprobe:\n {2}probe +the commands of the probe extension\n {2}ping +answer pong\n/
    );
  });
});

describe('a command name someone else has: only agentage <id> <command> runs it', () => {
  test('pong after probe: agentage ping stays probe, agentage pong ping runs pong', async ({
    dir,
  }) => {
    probeAndPong(dir);
    const kit = fakeKit();
    await agentage({ kitTool: kit.tool }, 'ping');
    await agentage({ kitTool: kit.tool }, 'pong', 'ping');
    expect(kit.runs.map((r) => r.dir)).toEqual([fixture('probe'), fixture('pong')]);
  });

  test('agentage status stays the core command; agentage pong status runs the kit', async ({
    dir,
  }) => {
    probeAndPong(dir);
    const kit = fakeKit();
    expect((await agentage({ kitTool: kit.tool }, 'status')).lines).toEqual(['core status']);
    expect((await agentage({ kitTool: kit.tool }, 'pong', 'status')).lines).toEqual(['status']);
    expect(kit.runs).toEqual([{ dir: fixture('pong'), command: 'status', argv: [] }]);
  });

  test('the holder commands.json names keeps agentage ping, whatever the order on disk', async ({
    dir,
  }) => {
    probeAndPong(dir);
    dir.write('commands.json', { ping: pkg('pong') });
    const kit = fakeKit();
    await agentage({ kitTool: kit.tool }, 'ping');
    expect(kit.runs.map((r) => r.dir)).toEqual([fixture('pong')]);
  });

  test('agentage nope lists each extension with what to type', async ({ dir }) => {
    probeAndPong(dir);
    const nope = await agentage({ kitTool: fakeKit().tool }, 'nope');
    expect(nope.code).toBe(2);
    expect(nope.err).toBe(
      "error: unknown command 'nope'\ncore: setup, status, update, extension\n" +
        'probe: ping\npong: pong ping, pong status\n'
    );
  });
});
