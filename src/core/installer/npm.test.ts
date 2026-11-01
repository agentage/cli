import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveNpmCli,
  scrubNpmEnv,
  type NpmResult,
  type RunNpmOptions,
} from '../../lib/npm/npm-cli.js';
import {
  DEFAULT_NPM_TIMEOUT_MS,
  DEFAULT_REGISTRY,
  npmArgs,
  npmSettings,
  prepareNpm,
  type NpmDeps,
  type NpmSettings,
} from './npm.js';

const SETTINGS: NpmSettings = {
  registry: 'http://127.0.0.1:4873',
  timeoutMs: 1000,
  userconfig: '/tmp/home/.npmrc',
  cache: '/tmp/npm-cache',
};

const ok = (stdout: string): NpmResult => ({ code: 0, stdout, stderr: '' });

const fakeDeps = (version: string, over: Partial<NpmDeps> = {}) => {
  const calls: { args: string[]; opts: RunNpmOptions }[] = [];
  const deps: NpmDeps = {
    env: {},
    execPath: '/opt/node/bin/node',
    resolveCli: vi.fn(() => '/opt/node/lib/node_modules/npm/bin/npm-cli.js'),
    run: vi.fn(async (args: string[], opts: RunNpmOptions) => {
      calls.push({ args, opts });
      return args[0] === '--version' ? ok(`${version}\n`) : ok('added 2 packages');
    }),
    ...over,
  };
  return { deps, calls };
};

describe('npmSettings', () => {
  it('defaults to the public registry and a ten-minute timeout', () => {
    expect(npmSettings({})).toEqual({
      registry: DEFAULT_REGISTRY,
      timeoutMs: DEFAULT_NPM_TIMEOUT_MS,
      userconfig: null,
      cache: null,
    });
  });

  it('reads the registry, a valid timeout and the npm userconfig and cache in any case', () => {
    const env = {
      AGENTAGE_NPM_REGISTRY: 'http://127.0.0.1:4873/',
      AGENTAGE_NPM_TIMEOUT_MS: '5000',
      npm_config_userconfig: '/h/.npmrc',
      NPM_CONFIG_CACHE: '/c',
    };
    expect(npmSettings(env)).toEqual({
      registry: 'http://127.0.0.1:4873',
      timeoutMs: 5000,
      userconfig: '/h/.npmrc',
      cache: '/c',
    });
  });

  it('ignores a bad timeout and refuses a registry that is not a URL', () => {
    expect(npmSettings({ AGENTAGE_NPM_TIMEOUT_MS: '-1' }).timeoutMs).toBe(DEFAULT_NPM_TIMEOUT_MS);
    expect(npmSettings({ AGENTAGE_NPM_TIMEOUT_MS: 'x' }).timeoutMs).toBe(DEFAULT_NPM_TIMEOUT_MS);
    expect(() => npmSettings({ AGENTAGE_NPM_REGISTRY: 'file:/x' })).toThrow(
      'AGENTAGE_NPM_REGISTRY is not a URL: file:/x'
    );
  });
});

describe('npmArgs', () => {
  it('passes prefix, registry, ignore-scripts and the carried config explicitly', () => {
    expect(npmArgs('ci', '/p/trees/.staging-1', SETTINGS)).toEqual([
      'ci',
      '--prefix',
      '/p/trees/.staging-1',
      '--registry',
      'http://127.0.0.1:4873',
      '--ignore-scripts',
      '--no-update-notifier',
      '--userconfig',
      '/tmp/home/.npmrc',
      '--cache',
      '/tmp/npm-cache',
    ]);
  });

  it('leaves userconfig and cache to npm when the parent set none', () => {
    const args = npmArgs('install', '/t', { ...SETTINGS, userconfig: null, cache: null });
    expect(args).not.toContain('--userconfig');
    expect(args).not.toContain('--cache');
  });
});

describe('prepareNpm (T36)', () => {
  it('resolves npm-cli.js once and runs every call through it', async () => {
    const { deps, calls } = fakeDeps('10.9.0');
    const npm = await prepareNpm(SETTINGS, deps);
    await npm.run('install', '/t');
    expect(deps.resolveCli).toHaveBeenCalledTimes(1);
    expect(deps.resolveCli).toHaveBeenCalledWith({ execPath: '/opt/node/bin/node', env: {} });
    expect(calls.map((c) => c.opts.npmCli)).toEqual([
      '/opt/node/lib/node_modules/npm/bin/npm-cli.js',
      '/opt/node/lib/node_modules/npm/bin/npm-cli.js',
    ]);
    expect(calls[1]?.opts).toMatchObject({ cwd: '/t', timeoutMs: 1000 });
    expect(calls[1]?.args.slice(0, 3)).toEqual(['install', '--prefix', '/t']);
  });

  it('probes the version with the carried userconfig and cache', async () => {
    const { deps, calls } = fakeDeps('11.7.0');
    await prepareNpm(SETTINGS, deps);
    expect(calls[0]?.args).toEqual([
      '--version',
      '--userconfig',
      '/tmp/home/.npmrc',
      '--cache',
      '/tmp/npm-cache',
    ]);
  });

  it('refuses npm below 10 before anything runs', async () => {
    const { deps, calls } = fakeDeps('9.8.1');
    await expect(prepareNpm(SETTINGS, deps)).rejects.toThrow(
      'npm 10 or newer is required (found 9.8.1)'
    );
    expect(calls).toHaveLength(1);
  });

  it('fails when no npm-cli.js can be found', async () => {
    const resolveCli = vi.fn(() => {
      throw new Error('npm-cli.js not found next to /n');
    });
    const { deps } = fakeDeps('10.0.0', { resolveCli });
    await expect(prepareNpm(SETTINGS, deps)).rejects.toThrow('npm-cli.js not found');
  });
});

describe('npm resolution and the child env (T36)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-installer-npm-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const touch = (...parts: string[]): string => {
    const path = join(dir, ...parts);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    return path;
  };

  it('prefers the npm-cli.js next to node (POSIX and Windows layouts)', () => {
    const posix = touch('posix', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const env = { npm_execpath: '/elsewhere/npm-cli.js' };
    expect(resolveNpmCli({ execPath: join(dir, 'posix', 'bin', 'node'), env })).toBe(posix);
    const win = touch('win', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    expect(resolveNpmCli({ execPath: join(dir, 'win', 'node.exe'), env })).toBe(win);
  });

  it('accepts npm_execpath only when it ends in npm-cli.js', () => {
    const execPath = join(dir, 'bare', 'node');
    const viaNpm = '/opt/npm/bin/npm-cli.js';
    expect(resolveNpmCli({ execPath, env: { npm_execpath: viaNpm, PATH: '' } })).toBe(viaNpm);
    const env = { npm_execpath: '/opt/yarn/bin/yarn.js', PATH: '' };
    expect(() => resolveNpmCli({ execPath, env })).toThrow('npm-cli.js not found');
  });

  it('scrubs npm_config_* and NODE_OPTIONS while settings keep userconfig and cache', () => {
    const parent = {
      PATH: '/bin',
      HOME: '/h',
      NODE_OPTIONS: '--require /evil.js',
      npm_config_registry: 'https://mirror.invalid',
      npm_config_userconfig: '/h/.npmrc',
      npm_config_cache: '/c',
    };
    expect(scrubNpmEnv(parent)).toEqual({ PATH: '/bin', HOME: '/h' });
    const args = npmArgs('ci', '/t', npmSettings(parent));
    expect(args).toEqual(expect.arrayContaining(['--userconfig', '/h/.npmrc', '--cache', '/c']));
    expect(args).toContain(DEFAULT_REGISTRY);
  });
});
