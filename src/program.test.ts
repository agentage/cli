import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { createProgram, run, type ProgramDeps } from './program.js';
import { test } from './test/config-dir.js';
import { VERSION } from './utils/version.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[`);

const makeDeps = (over: Partial<ProgramDeps> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: ProgramDeps = {
    setup: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    authToken: vi.fn(async () => undefined),
    extensionInstall: vi.fn(async () => undefined),
    extensionRemove: vi.fn(async () => undefined),
    extensionList: vi.fn(async () => undefined),
    extensionDoctor: vi.fn(async () => undefined),
    extensionCheck: vi.fn(async () => undefined),
    extensionCreate: vi.fn(async () => undefined),
    extensionBuild: vi.fn(async () => undefined),
    extensionRelease: vi.fn(async () => undefined),
    extensionUp: vi.fn(async () => undefined),
    extensionDown: vi.fn(async () => undefined),
    extensionToken: vi.fn(async () => undefined),
    extensionUpdate: vi.fn(async () => undefined),
    extensionEnabled: vi.fn(async () => undefined),
    extensionConfigure: vi.fn(async () => undefined),
    daemon: {
      start: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      run: vi.fn(async () => undefined),
    },
    kitTool: vi.fn(async () => {
      throw new Error('no kit in these tests');
    }),
    updateHint: vi.fn(() => 'update available: 9.9.9'),
    refreshUpdateCache: vi.fn(async () => undefined),
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
    ...over,
  };
  const exec = (...args: string[]): Promise<number> => run(['node', 'agentage', ...args], deps);
  return { deps, exec, stdout: () => out.join(''), stderr: () => err.join('') };
};

const boom = async (): Promise<void> => {
  throw new Error('boom');
};

describe('run', () => {
  let level: typeof chalk.level;

  beforeEach(() => {
    level = chalk.level;
  });

  afterEach(() => {
    chalk.level = level;
    delete process.env['NO_COLOR'];
  });

  test('exits 2 on an unknown command, reporting it on stderr', async () => {
    const h = makeDeps();
    expect(await h.exec('nope')).toBe(2);
    expect(h.stderr()).toContain("unknown command 'nope'");
    expect(h.stdout()).toBe('');
  });

  test('exits 2 on an unknown option or a missing option argument', async () => {
    const h = makeDeps();
    expect(await h.exec('status', '--nope')).toBe(2);
    expect(h.stderr()).toContain("unknown option '--nope'");
    expect(await h.exec('status', '--token')).toBe(2);
    expect(h.deps.status).not.toHaveBeenCalled();
  });

  test('exits 2 when no command is given, with help on stderr', async () => {
    const h = makeDeps();
    expect(await h.exec()).toBe(2);
    expect(h.stderr()).toContain('Usage: agentage');
    expect(h.stdout()).toBe('');
  });

  test('exits 0 for --help and help, printing to stdout', async () => {
    for (const args of [['--help'], ['help'], ['setup', '--help']]) {
      const h = makeDeps();
      expect(await h.exec(...args), args.join(' ')).toBe(0);
      expect(h.stdout()).toContain('Usage: agentage');
      expect(h.stderr()).toBe('');
    }
  });

  test('exits 0 for --version, printing only the version to stdout', async () => {
    const h = makeDeps();
    expect(await h.exec('--version')).toBe(0);
    expect(h.stdout()).toBe(`${VERSION}\n`);
    expect(h.stderr()).toBe('');
  });

  test('exits 0 and passes the parsed options to the command', async () => {
    const h = makeDeps();
    expect(await h.exec('status', '--json', '--token', 'aga_x')).toBe(0);
    expect(h.deps.status).toHaveBeenCalledWith({ json: true, token: 'aga_x' });
    expect(await h.exec('setup', '--no-browser', '--reauth')).toBe(0);
    expect(h.deps.setup).toHaveBeenCalledWith({ browser: false, daemon: true, reauth: true });
    expect(await h.exec('setup', '--latest')).toBe(0);
    expect(h.deps.setup).toHaveBeenLastCalledWith({ browser: true, daemon: true, latest: true });
    expect(await h.exec('update', '--check')).toBe(0);
    expect(h.deps.update).toHaveBeenCalledWith({ check: true });
  });

  test('exits 1 when a command throws, with the message on stderr only', async () => {
    const h = makeDeps({ status: boom, update: boom });
    expect(await h.exec('status')).toBe(1);
    expect(await h.exec('update')).toBe(1);
    expect(h.stderr().split('\n').filter(Boolean)).toHaveLength(2);
    expect(h.stderr()).toContain('boom');
    expect(h.stdout()).toBe('');
  });

  test('keeps the "Setup failed:" prefix and skips the update hint after a failure', async () => {
    const h = makeDeps({ setup: boom });
    expect(await h.exec('setup')).toBe(1);
    expect(h.stderr()).toContain('Setup failed: boom');
    expect(h.stderr()).not.toContain('update available');
  });

  test('exits 1 for a failure outside any command action', async () => {
    const h = makeDeps({
      updateHint: () => {
        throw new Error('hint broke');
      },
    });
    expect(await h.exec('setup')).toBe(1);
    expect(h.stderr()).toContain('hint broke');
  });

  test('prints the update hint to stderr after setup and refreshes the cache', async () => {
    const h = makeDeps();
    expect(await h.exec('setup')).toBe(0);
    expect(h.stderr()).toContain('update available: 9.9.9');
    expect(h.stdout()).toBe('');
    expect(h.deps.refreshUpdateCache).toHaveBeenCalledOnce();
  });

  test('leaves the update hint to status and update themselves', async () => {
    const h = makeDeps();
    await h.exec('status', '--json');
    await h.exec('update');
    expect(h.stderr()).toBe('');
    expect(h.deps.refreshUpdateCache).not.toHaveBeenCalled();
  });

  test('honours NO_COLOR, which chalk alone ignores', async () => {
    chalk.level = 3;
    const colored = makeDeps({ status: boom });
    await colored.exec('status');
    expect(colored.stderr()).toMatch(ANSI);
    process.env['NO_COLOR'] = '1';
    const plain = makeDeps({ status: boom });
    await plain.exec('status');
    expect(plain.stderr()).not.toMatch(ANSI);
  });
});

describe('createProgram', () => {
  afterEach(() => {
    delete process.env['AGENTAGE_EXTENSIONS'];
  });

  test('registers the core commands and the extension group, whatever AGENTAGE_EXTENSIONS says', async () => {
    for (const value of [undefined, '0', '1']) {
      if (value === undefined) delete process.env['AGENTAGE_EXTENSIONS'];
      else process.env['AGENTAGE_EXTENSIONS'] = value;
      const names = createProgram(makeDeps().deps).commands.map((c) => c.name());
      expect(names, String(value)).toEqual([
        'setup',
        'status',
        'update',
        'auth',
        'daemon',
        'extension',
      ]);
    }
  });

  test('daemon start, status, stop and restart take --json; run is hidden; alone it prints help', async () => {
    const h = makeDeps();
    for (const name of ['start', 'status', 'stop', 'restart'] as const) {
      expect(await h.exec('daemon', name, '--json')).toBe(0);
      expect(h.deps.daemon[name]).toHaveBeenCalledWith({ json: true });
    }
    expect(await h.exec('daemon', 'run')).toBe(0);
    expect(h.deps.daemon.run).toHaveBeenCalledOnce();
    expect(await h.exec('daemon')).toBe(0);
    expect(h.stdout()).toMatch(/status \[options\] +Show the daemon/);
    expect(h.stdout()).not.toMatch(/^\s+run\b/m);
    expect(await h.exec('daemon', 'nope')).toBe(2);
  });

  test('extension alone prints its help; list and doctor pass --json; an unknown subcommand is usage', async () => {
    const h = makeDeps();
    expect(await h.exec('extension')).toBe(0);
    expect(h.stdout()).toContain('Usage: agentage extension');
    expect(await h.exec('extension', 'list', '--json')).toBe(0);
    expect(h.deps.extensionList).toHaveBeenCalledWith({ json: true });
    expect(await h.exec('extension', 'doctor', '--json')).toBe(0);
    expect(h.deps.extensionDoctor).toHaveBeenCalledWith({ json: true });
    expect(await h.exec('extension', 'nope')).toBe(2);
    expect(h.stderr()).toContain("unknown command 'nope'");
  });

  test('extension check [dir] is the conformance check; doctor stays the installed health', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'check', 'probe', '--json')).toBe(0);
    expect(h.deps.extensionCheck).toHaveBeenLastCalledWith({ dir: 'probe', json: true });
    expect(await h.exec('extension', 'check')).toBe(0);
    expect(h.deps.extensionCheck).toHaveBeenLastCalledWith({ dir: undefined });
    expect(await h.exec('extension', 'check', '--write')).toBe(0);
    expect(h.deps.extensionCheck).toHaveBeenLastCalledWith({ dir: undefined, write: true });
    expect(h.deps.extensionDoctor).not.toHaveBeenCalled();
    const failing = makeDeps({ extensionCheck: boom });
    expect(await failing.exec('extension', 'check')).toBe(1);
  });

  test('extension up, down and token pass their flags; token needs --scope and an http(s) issuer', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'up', '--dir', 'probe')).toBe(0);
    expect(h.deps.extensionUp).toHaveBeenLastCalledWith({ dir: 'probe' });
    expect(await h.exec('extension', 'up', '--docker')).toBe(0);
    expect(h.deps.extensionUp).toHaveBeenLastCalledWith({ docker: true });
    expect(await h.exec('extension', 'up', '--local')).toBe(0);
    expect(h.deps.extensionUp).toHaveBeenLastCalledWith({ local: true });
    expect(await h.exec('extension', 'down', '--keep-data')).toBe(0);
    expect(h.deps.extensionDown).toHaveBeenLastCalledWith({ keepData: true });
    const issuer = ['--issuer', 'http://localhost:4281'];
    expect(await h.exec('extension', 'token', '--scope', 'probe:write', ...issuer)).toBe(0);
    expect(h.deps.extensionToken).toHaveBeenLastCalledWith({
      scope: 'probe:write',
      issuer: 'http://localhost:4281',
    });
    expect(await h.exec('extension', 'token')).toBe(2);
    expect(h.stderr()).toContain("required option '--scope <scope>' not specified");
    expect(await h.exec('extension', 'token', '--scope', 'x:y', '--issuer', 'ftp://x')).toBe(2);
    expect(h.stderr()).toContain('not an http: or https: URL.');
    expect(await makeDeps({ extensionUp: boom }).exec('extension', 'up')).toBe(1);
  });

  test('the lifecycle commands pass their arguments and flags; extension --help lists C1 in order', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'install', 'hello', '--off')).toBe(0);
    expect(h.deps.extensionInstall).toHaveBeenCalledWith({ name: 'hello', off: true });
    expect(await h.exec('extension', 'remove', 'hello', '--purge', '--yes')).toBe(0);
    expect(h.deps.extensionRemove).toHaveBeenCalledWith({ name: 'hello', purge: true, yes: true });
    expect(await h.exec('extension', 'list', '--available')).toBe(0);
    expect(h.deps.extensionList).toHaveBeenCalledWith({ available: true });
    expect(await h.exec('extension', 'update', 'probe', '--check')).toBe(0);
    expect(h.deps.extensionUpdate).toHaveBeenCalledWith({ id: 'probe', check: true });
    expect(await h.exec('extension', 'disable', 'probe')).toBe(0);
    expect(h.deps.extensionEnabled).toHaveBeenLastCalledWith({ id: 'probe', enabled: false });
    expect(await h.exec('extension', 'enable', 'probe')).toBe(0);
    expect(h.deps.extensionEnabled).toHaveBeenLastCalledWith({ id: 'probe', enabled: true });
    expect(await h.exec('extension', 'configure', 'probe', 'a=1', 'b=2', '--secret')).toBe(0);
    expect(h.deps.extensionConfigure).toHaveBeenCalledWith({
      id: 'probe',
      pairs: ['a=1', 'b=2'],
      secret: true,
    });
    expect(await h.exec('extension', 'install')).toBe(2);
    expect(h.stderr()).toContain("missing required argument 'name'");
    expect(await h.exec('extension', '--help')).toBe(0);
    const words =
      'install|list|update|disable|enable|configure|remove|doctor|create|check|build|up';
    const listed = h.stdout().match(new RegExp(`^ {2}(${words})\\b`, 'gm'));
    expect(listed?.map((l) => l.trim())).toEqual(words.split('|'));
  });

  test('extension create passes the id, the parts and --from; no id is usage', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'create', 'market', 'mcp', 'api', '--from', 'x/y')).toBe(0);
    expect(h.deps.extensionCreate).toHaveBeenLastCalledWith({
      id: 'market',
      parts: ['mcp', 'api'],
      from: 'x/y',
      install: true,
    });
    expect(await h.exec('extension', 'create', 'market', '--yes')).toBe(0);
    expect(h.deps.extensionCreate).toHaveBeenLastCalledWith({
      id: 'market',
      parts: [],
      install: true,
      yes: true,
    });
    expect(await h.exec('extension', 'create', 'market', '--no-install')).toBe(0);
    expect(h.deps.extensionCreate).toHaveBeenLastCalledWith({
      id: 'market',
      parts: [],
      install: false,
    });
    expect(await h.exec('extension', 'create')).toBe(2);
  });

  test('extension build passes --push, --dir and --registry; a failed build exits 1', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'build')).toBe(0);
    expect(h.deps.extensionBuild).toHaveBeenLastCalledWith({});
    expect(await h.exec('extension', 'build', '--push', '--dir', 'ext', '--registry', 'r/o')).toBe(
      0
    );
    expect(h.deps.extensionBuild).toHaveBeenLastCalledWith({
      push: true,
      dir: 'ext',
      registry: 'r/o',
    });
    expect(await h.exec('extension', 'build', '--container')).toBe(0);
    expect(h.deps.extensionBuild).toHaveBeenLastCalledWith({ container: true });
    expect(await h.exec('extension', 'build', '--docker')).toBe(0);
    expect(h.deps.extensionBuild).toHaveBeenLastCalledWith({ docker: true });
    expect(await h.exec('extension', 'build', '--dir')).toBe(2);
    const failing = makeDeps({ extensionBuild: boom });
    expect(await failing.exec('extension', 'build')).toBe(1);
    expect(failing.stderr()).toContain('boom');
  });

  test('extension release passes --dir and --timeout as seconds; a refusal exits 1', async () => {
    const h = makeDeps();
    expect(await h.exec('extension', 'release', '--dir', 'ext', '--timeout', '5')).toBe(0);
    expect(h.deps.extensionRelease).toHaveBeenLastCalledWith({ dir: 'ext', timeout: 5 });
    const failing = makeDeps({ extensionRelease: boom });
    expect(await failing.exec('extension', 'release')).toBe(1);
    expect(failing.stderr()).toContain('boom');
  });

  test.for(['--profile=x', '--dry-run', '--check', '--disconnect'])(
    'setup --latest with %s is a usage error',
    async (other) => {
      const h = makeDeps();
      expect(await h.exec('setup', '--latest', other)).toBe(2);
      expect(h.stderr()).toContain("option '--latest' cannot be used with option");
      expect(h.deps.setup).not.toHaveBeenCalled();
    }
  );
});
