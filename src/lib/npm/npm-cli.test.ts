import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireNpm10, resolveNpmCli, runNpm, type NpmResult } from './npm-cli.js';

const touch = (path: string): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
  return path;
};

describe('resolveNpmCli', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-npm-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const npmCli = (...parts: string[]): string =>
    join(dir, ...parts, 'node_modules', 'npm', 'bin', 'npm-cli.js');

  it('finds the POSIX layout: <prefix>/lib/node_modules/npm next to bin/node', () => {
    const expected = touch(npmCli('posix', 'lib'));
    expect(resolveNpmCli({ execPath: join(dir, 'posix', 'bin', 'node'), env: {} })).toBe(expected);
  });

  it('finds the Windows layout: node_modules/npm beside node.exe', () => {
    const expected = touch(npmCli('win'));
    expect(resolveNpmCli({ execPath: join(dir, 'win', 'node.exe'), env: {} })).toBe(expected);
  });

  it('falls back to npm_execpath only when it names npm-cli.js', () => {
    const execPath = join(dir, 'bare', 'node');
    const viaNpm = '/opt/npm/bin/npm-cli.js';
    expect(resolveNpmCli({ execPath, env: { npm_execpath: viaNpm } })).toBe(viaNpm);
    const env = { npm_execpath: '/opt/pnpm/bin/pnpm.cjs', PATH: '' };
    expect(() => resolveNpmCli({ execPath, env })).toThrow(/npm-cli.js not found/);
  });

  it.skipIf(process.platform === 'win32')('follows an `npm` symlink on PATH (Homebrew)', () => {
    const real = touch(npmCli('brew', 'lib'));
    mkdirSync(join(dir, 'brew', 'bin'), { recursive: true });
    symlinkSync(real, join(dir, 'brew', 'bin', 'npm'));
    const env = { PATH: `${join(dir, 'missing')}:${join(dir, 'brew', 'bin')}` };
    expect(resolveNpmCli({ execPath: join(dir, 'cellar', 'bin', 'node'), env })).toBe(real);
  });
});

describe('runNpm', () => {
  afterEach(() => {
    delete process.env['npm_config_init_license'];
  });

  it('runs the real npm through node, without a shell', async () => {
    const res = await runNpm(['--version'], { timeoutMs: 30_000 });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('scrubs inherited npm_config_* but keeps the ones the caller passes', async () => {
    process.env['npm_config_init_license'] = 'INHERITED';
    const inherited = await runNpm(['config', 'get', 'init-license'], { timeoutMs: 30_000 });
    expect(inherited.stdout.trim()).not.toBe('INHERITED');
    const env = { npm_config_init_license: 'EXPLICIT' };
    const explicit = await runNpm(['config', 'get', 'init-license'], { env, timeoutMs: 30_000 });
    expect(explicit.stdout.trim()).toBe('EXPLICIT');
  });

  it('returns npm exit code and stderr on failure, and names a timeout', async () => {
    const failed = await runNpm(['no-such-command-xyz'], { timeoutMs: 30_000 });
    expect(failed.code).not.toBe(0);
    const slow = await runNpm(['--version'], { timeoutMs: 1 });
    expect(slow.code).toBe(1);
    expect(slow.stderr).toContain('npm timed out after 1ms');
  });
});

describe('requireNpm10', () => {
  const fake =
    (res: NpmResult): typeof runNpm =>
    async () =>
      res;

  it('accepts npm 10 and newer and returns the version', async () => {
    await expect(requireNpm10(fake({ code: 0, stdout: '10.9.0\n', stderr: '' }))).resolves.toBe(
      '10.9.0'
    );
    await expect(requireNpm10(fake({ code: 0, stdout: '11.7.0\n', stderr: '' }))).resolves.toBe(
      '11.7.0'
    );
  });

  it('rejects an older npm or a failed probe', async () => {
    await expect(requireNpm10(fake({ code: 0, stdout: '9.8.1', stderr: '' }))).rejects.toThrow(
      'npm 10 or newer is required (found 9.8.1)'
    );
    await expect(requireNpm10(fake({ code: 1, stdout: '', stderr: 'x' }))).rejects.toThrow(
      '(found none)'
    );
  });

  it('passes against the npm this test runs on', async () => {
    await expect(requireNpm10()).resolves.toMatch(/^\d+\./);
  });
});
