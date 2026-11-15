import { describe, expect, vi } from 'vitest';
import { CliError } from './lib/json-output.js';
import { run, type ProgramDeps } from './program.js';
import { test } from './test/config-dir.js';

const harness = (over: Partial<ProgramDeps> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const ok = vi.fn(async () => ({ answer: 42 }));
  const deps = {
    setup: ok,
    status: ok,
    update: ok,
    extensionInstall: ok,
    extensionRemove: ok,
    extensionList: ok,
    extensionDoctor: ok,
    extensionCheck: ok,
    extensionCreate: ok,
    extensionBuild: ok,
    extensionRelease: ok,
    extensionUp: ok,
    extensionDown: ok,
    extensionToken: ok,
    kitTool: vi.fn(async () => {
      throw new Error('no kit');
    }),
    updateHint: vi.fn(() => 'update available'),
    refreshUpdateCache: vi.fn(async () => undefined),
    writeOut: (t: string) => void out.push(t),
    writeErr: (t: string) => void err.push(t),
    ...over,
  } as ProgramDeps;
  const exec = (...args: string[]) => run(['node', 'agentage', ...args], deps);
  return { exec, stdout: () => out.join(''), stderr: () => err.join('') };
};

const NEW: [string, string[], keyof ProgramDeps][] = [
  ['setup', ['setup'], 'setup'],
  ['update', ['update'], 'update'],
  ['extension install', ['extension', 'install', 'probe'], 'extensionInstall'],
  ['extension remove', ['extension', 'remove', 'probe'], 'extensionRemove'],
  ['extension create', ['extension', 'create', 'demo'], 'extensionCreate'],
  ['extension build', ['extension', 'build'], 'extensionBuild'],
  ['extension release', ['extension', 'release'], 'extensionRelease'],
  ['extension up', ['extension', 'up'], 'extensionUp'],
  ['extension down', ['extension', 'down'], 'extensionDown'],
  ['extension token', ['extension', 'token', '--scope', 'a:b'], 'extensionToken'],
];

describe('--json envelope', () => {
  for (const [name, argv, dep] of NEW) {
    test(`${name}: one success object on stdout`, async () => {
      const h = harness();
      expect(await h.exec(...argv, '--json')).toBe(0);
      expect(JSON.parse(h.stdout())).toEqual({ success: true, data: { answer: 42 } });
      expect(h.stdout().trim().split('\n')).toHaveLength(1);
      expect(h.stderr()).toBe('');
    });

    test(`${name}: an error becomes one error object, exit 1, no stderr text`, async () => {
      const fail = vi.fn(async () => {
        throw new CliError('not_installed', 'probe is not installed');
      });
      const h = harness({ [dep]: fail });
      expect(await h.exec(...argv, '--json')).toBe(1);
      expect(JSON.parse(h.stdout())).toEqual({
        success: false,
        error: { code: 'not_installed', message: 'probe is not installed' },
      });
      expect(h.stderr()).toBe('');
    });

    test(`${name}: without the flag the error stays red text on stderr`, async () => {
      const h = harness({
        [dep]: async () => {
          throw new Error('boom');
        },
      });
      expect(await h.exec(...argv)).toBe(1);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).toContain('boom');
    });
  }

  test('a plain Error gets the code error; progress lines go to stderr, not stdout', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log');
    const h = harness({
      extensionUp: async () => {
        console.log('step one');
        throw new Error('docker is missing');
      },
    });
    expect(await h.exec('extension', 'up', '--json')).toBe(1);
    expect(JSON.parse(h.stdout()).error).toEqual({ code: 'error', message: 'docker is missing' });
    expect(spy).toHaveBeenCalledWith('step one');
    log.mockRestore();
    spy.mockRestore();
  });

  test('a void result is data null', async () => {
    const h = harness({ extensionDown: async () => undefined });
    await h.exec('extension', 'down', '--json');
    expect(JSON.parse(h.stdout())).toEqual({ success: true, data: null });
  });
});

describe('--json on a command whose own shape is pinned', () => {
  test('status, list, doctor and check keep their JSON: no envelope on success', async () => {
    const h = harness({
      status: async () => void console.log('{"own":true}'),
    });
    expect(await h.exec('status', '--json')).toBe(0);
    expect(h.stdout()).toBe('');
  });

  test('an error before any output is the envelope; after output it stays stderr text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const early = harness({
      extensionList: async () => {
        throw new CliError('profile_invalid', 'bad');
      },
    });
    expect(await early.exec('extension', 'list', '--json')).toBe(1);
    expect(JSON.parse(early.stdout()).error.code).toBe('profile_invalid');
    const late = harness({
      extensionDoctor: async () => {
        console.log('{"report":1}');
        throw new Error('1 extension failed to load: x');
      },
    });
    expect(await late.exec('extension', 'doctor', '--json')).toBe(1);
    expect(late.stdout()).toBe('');
    expect(late.stderr()).toContain('failed to load');
    log.mockRestore();
  });

  test('setup --dry-run and --check keep the plan JSON; plain setup --json gets the envelope', async () => {
    const h = harness({ setup: async () => undefined });
    await h.exec('setup', '--dry-run', '--json');
    expect(h.stdout()).toBe('');
    await h.exec('setup', '--json');
    expect(JSON.parse(h.stdout())).toEqual({ success: true, data: null });
  });
});

describe('help', () => {
  test.each(NEW.map(([, argv]) => argv))('%s --help lists --json', async (...argv) => {
    const h = harness();
    expect(await h.exec(...argv, '--help')).toBe(0);
    expect(h.stdout()).toContain('--json');
  });
});
