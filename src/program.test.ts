import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, run, type ProgramDeps } from './program.js';
import { VERSION } from './utils/version.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[`);

const makeDeps = (over: Partial<ProgramDeps> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: ProgramDeps = {
    setup: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
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

  it('exits 2 on an unknown command, reporting it on stderr', async () => {
    const h = makeDeps();
    expect(await h.exec('nope')).toBe(2);
    expect(h.stderr()).toContain("unknown command 'nope'");
    expect(h.stdout()).toBe('');
  });

  it('exits 2 on an unknown option or a missing option argument', async () => {
    const h = makeDeps();
    expect(await h.exec('status', '--nope')).toBe(2);
    expect(h.stderr()).toContain("unknown option '--nope'");
    expect(await h.exec('status', '--token')).toBe(2);
    expect(h.deps.status).not.toHaveBeenCalled();
  });

  it('exits 2 when no command is given, with help on stderr', async () => {
    const h = makeDeps();
    expect(await h.exec()).toBe(2);
    expect(h.stderr()).toContain('Usage: agentage');
    expect(h.stdout()).toBe('');
  });

  it('exits 0 for --help and help, printing to stdout', async () => {
    for (const args of [['--help'], ['help'], ['setup', '--help']]) {
      const h = makeDeps();
      expect(await h.exec(...args), args.join(' ')).toBe(0);
      expect(h.stdout()).toContain('Usage: agentage');
      expect(h.stderr()).toBe('');
    }
  });

  it('exits 0 for --version, printing only the version to stdout', async () => {
    const h = makeDeps();
    expect(await h.exec('--version')).toBe(0);
    expect(h.stdout()).toBe(`${VERSION}\n`);
    expect(h.stderr()).toBe('');
  });

  it('exits 0 and passes the parsed options to the command', async () => {
    const h = makeDeps();
    expect(await h.exec('status', '--json', '--token', 'aga_x')).toBe(0);
    expect(h.deps.status).toHaveBeenCalledWith({ json: true, token: 'aga_x' });
    expect(await h.exec('setup', '--no-browser', '--reauth')).toBe(0);
    expect(h.deps.setup).toHaveBeenCalledWith({ browser: false, reauth: true });
    expect(await h.exec('update', '--check')).toBe(0);
    expect(h.deps.update).toHaveBeenCalledWith({ check: true });
  });

  it('exits 1 when a command throws, with the message on stderr only', async () => {
    const h = makeDeps({ status: boom, update: boom });
    expect(await h.exec('status')).toBe(1);
    expect(await h.exec('update')).toBe(1);
    expect(h.stderr().split('\n').filter(Boolean)).toHaveLength(2);
    expect(h.stderr()).toContain('boom');
    expect(h.stdout()).toBe('');
  });

  it('keeps the "Setup failed:" prefix and skips the update hint after a failure', async () => {
    const h = makeDeps({ setup: boom });
    expect(await h.exec('setup')).toBe(1);
    expect(h.stderr()).toContain('Setup failed: boom');
    expect(h.stderr()).not.toContain('update available');
  });

  it('exits 1 for a failure outside any command action', async () => {
    const h = makeDeps({
      updateHint: () => {
        throw new Error('hint broke');
      },
    });
    expect(await h.exec('setup')).toBe(1);
    expect(h.stderr()).toContain('hint broke');
  });

  it('prints the update hint to stderr after setup and refreshes the cache', async () => {
    const h = makeDeps();
    expect(await h.exec('setup')).toBe(0);
    expect(h.stderr()).toContain('update available: 9.9.9');
    expect(h.stdout()).toBe('');
    expect(h.deps.refreshUpdateCache).toHaveBeenCalledOnce();
  });

  it('leaves the update hint to status and update themselves', async () => {
    const h = makeDeps();
    await h.exec('status', '--json');
    await h.exec('update');
    expect(h.stderr()).toBe('');
    expect(h.deps.refreshUpdateCache).not.toHaveBeenCalled();
  });

  it('honours NO_COLOR, which chalk alone ignores', async () => {
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
  it('registers exactly the launcher commands', () => {
    const names = createProgram(makeDeps().deps).commands.map((c) => c.name());
    expect(names).toEqual(['setup', 'status', 'update']);
  });
});
