import { chmodSync } from 'node:fs';
import { describe, expect, vi } from 'vitest';
import { run, type ProgramDeps } from './program.js';
import { defaultDeps } from './program-deps.js';
import { test } from './test/config-dir.js';
import { freePort } from './test/serve.js';

// The real commands with injected failures: each is one envelope with its code, never a stack.
const runReal = async (args: string[], over: Partial<ProgramDeps> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps: ProgramDeps = {
    ...defaultDeps,
    updateHint: () => null,
    refreshUpdateCache: async () => undefined,
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
    ...over,
  };
  const code = await run(['node', 'agentage', ...args], deps);
  quiet.mockRestore();
  const envelope = JSON.parse(out.join('')) as { error: { code: string; message: string } };
  return { code, error: envelope.error, stderr: err.join('') };
};

const thrower = (err: Error) => async (): Promise<never> => {
  throw err;
};

const asRoot = process.getuid?.() === 0;

const errno = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('expected failures reach the user as a code and one line', () => {
  test('network down', async () => {
    const cause = errno('ENOTFOUND', 'getaddrinfo ENOTFOUND api.example.test');
    const down = thrower(new TypeError('fetch failed', { cause }));
    const got = await runReal(['status', '--json'], { status: down });
    expect(got.code).toBe(1);
    expect(got.error).toEqual({
      code: 'network_unavailable',
      message: 'fetch failed: getaddrinfo ENOTFOUND api.example.test',
    });
  });

  test('disk full on a write', async () => {
    const full = thrower(errno('ENOSPC', "ENOSPC: no space left on device, write '/x/a.json'"));
    const got = await runReal(['extension', 'list', '--json'], { extensionList: full });
    expect(got.error).toEqual({
      code: 'disk_full',
      message: "ENOSPC: no space left on device, write '/x/a.json'",
    });
  });

  // Root writes through a 0o500 folder: an environment condition, so the runner's skipIf.
  test.skipIf(asRoot)('permission denied on the config folder', async ({ dir }) => {
    dir.write('profile.json', { version: 1, extensions: {} });
    chmodSync(dir.at(''), 0o500);
    process.env['AGENTAGE_DAEMON_PORT'] = String(await freePort());
    try {
      const got = await runReal(['extension', 'list', '--json']);
      expect(got.error.code).toBe('permission_denied');
      expect(got.error.message).toMatch(/^EACCES: permission denied, mkdir '.*logs'$/);
    } finally {
      chmodSync(dir.at(''), 0o700);
      delete process.env['AGENTAGE_DAEMON_PORT'];
    }
  });

  test('a corrupt JSON file in the config folder', async ({ dir }) => {
    dir.write('profile.json', '{ half');
    const got = await runReal(['setup', '--dry-run', '--json']);
    expect(got.error).toEqual({
      code: 'profile_invalid',
      message: 'profile.json is invalid: not valid JSON',
    });
  });

  test('AGENTAGE_DEBUG=1 adds the original error and its cause with stacks on stderr', async () => {
    vi.stubEnv('AGENTAGE_DEBUG', '1');
    const cause = errno('ENOTFOUND', 'getaddrinfo ENOTFOUND api.example.test');
    const down = thrower(new TypeError('fetch failed', { cause }));
    const got = await runReal(['status', '--json'], { status: down });
    vi.unstubAllEnvs();
    expect(got.error.code).toBe('network_unavailable');
    expect(got.stderr).toMatch(/^TypeError: fetch failed\n\s+at /);
    expect(got.stderr).toMatch(/\nError: getaddrinfo ENOTFOUND api\.example\.test\n\s+at /);
  });

  test('in text mode the same failure is one red line on stderr, no stack', async () => {
    const out: string[] = [];
    const full = thrower(errno('ENOSPC', 'ENOSPC: no space left on device'));
    const deps = {
      ...defaultDeps,
      extensionList: full,
      updateHint: () => null,
      refreshUpdateCache: async () => undefined,
    };
    const code = await run(['node', 'agentage', 'extension', 'list'], {
      ...deps,
      writeErr: (text) => void out.push(text),
    });
    expect(code).toBe(1);
    expect(out.join('').trim().split('\n')).toHaveLength(1);
    expect(out.join('')).not.toMatch(/\n\s+at /);
  });
});
