import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type NpmResult } from '../../lib/npm/npm-cli.js';
import {
  checkInstallSet,
  defaultInstallerDeps,
  install,
  lastLines,
  planInstall,
  type InstallerDeps,
} from './installer.js';
import { type InstallerNpm, type NpmCommand } from './npm.js';
import { treeName } from './tree.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const TWO = { [WORLD]: '^1', [HELLO]: '^1.0.0' };

// Plays npm: `install` writes a lock from package.json, both lay out node_modules.
const fakeNpm = (result: Partial<NpmResult> = {}) => {
  const runs: NpmCommand[] = [];
  const npm: InstallerNpm = {
    major: 10,
    run: async (command, tree) => {
      runs.push(command);
      if (result.code) return { code: result.code, stdout: '', stderr: '', ...result };
      const pkg = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf-8')) as {
        dependencies: Record<string, string>;
      };
      const packages = Object.fromEntries(
        Object.keys(pkg.dependencies).map((n) => [
          `node_modules/${n}`,
          { version: '1.0.0', integrity: `sha512-${n}` },
        ])
      );
      const lock = { lockfileVersion: 3, packages: { '': pkg, ...packages } };
      if (command === 'install')
        writeFileSync(join(tree, 'package-lock.json'), JSON.stringify(lock));
      return { code: 0, stdout: 'added', stderr: '' };
    },
  };
  return { npm, runs };
};

describe('installer', () => {
  let dir: string;
  let npm: ReturnType<typeof fakeNpm>;
  let deps: InstallerDeps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-installer-'));
    npm = fakeNpm();
    deps = {
      pluginsDir: () => dir,
      settings: () => ({ registry: 'http://r', timeoutMs: 1, userconfig: null, cache: null }),
      scopes: () => ['@agentage'],
      prepareNpm: vi.fn(async () => npm.npm),
      lock: vi.fn((_dir: string, fn: () => Promise<unknown>) => fn()) as InstallerDeps['lock'],
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = (...parts: string[]): string => readFileSync(join(dir, ...parts), 'utf-8');
  const trees = (): string[] => readdirSync(join(dir, 'trees')).sort();

  it('plans npm install with no lock, and names no tree yet', () => {
    const plan = planInstall(TWO, deps);
    expect(plan).toMatchObject({ npm: 'install', tree: null, reuse: false, lock: null });
    expect(Object.keys(plan.install)).toEqual([HELLO, WORLD]);
    expect(plan.registry).toBe('http://r');
    expect(existsSync(join(dir, 'trees'))).toBe(false);
  });

  it('installs into a complete tree named by the lock, then points current at it', async () => {
    const result = await install(TWO, deps);
    expect(result).toMatchObject({ npm: 'install', reused: false, count: 2 });
    expect(trees()).toEqual([result.tree]);
    expect(read('current')).toBe(`${result.tree}\n`);
    expect(existsSync(join(dir, 'trees', result.tree, '.complete'))).toBe(true);
    expect(read('package-lock.json')).toBe(read('trees', result.tree, 'package-lock.json'));
    expect(read('npm-major')).toBe('10\n');
    expect(deps.lock).toHaveBeenCalledWith(dir, expect.any(Function));
  });

  it('reuses the complete tree on a second run without npm (T07)', async () => {
    const first = await install(TWO, deps);
    expect(planInstall(TWO, deps)).toMatchObject({ npm: null, tree: first.tree, reuse: true });
    const second = await install(TWO, deps);
    expect(second).toMatchObject({ tree: first.tree, npm: null, reused: true });
    expect(npm.runs).toEqual(['install']);
    expect(deps.prepareNpm).toHaveBeenCalledTimes(1);
  });

  it('runs npm ci from a matching lock when its tree is gone, keeping the npm major', async () => {
    const first = await install(TWO, deps);
    rmSync(join(dir, 'trees'), { recursive: true });
    writeFileSync(join(dir, 'npm-major'), '11\n');
    expect(planInstall(TWO, deps)).toMatchObject({ npm: 'ci', tree: first.tree, reuse: false });
    const again = await install(TWO, deps);
    expect(again).toMatchObject({ tree: first.tree, npm: 'ci' });
    expect(read('npm-major')).toBe('11\n');
  });

  it('carries a lock that no longer matches into npm install', async () => {
    await install({ [HELLO]: '^1.0.0' }, deps);
    const plan = planInstall(TWO, deps);
    expect(plan).toMatchObject({ npm: 'install', tree: null });
    expect(plan.lock).toBe(read('package-lock.json'));
  });

  it('skips npm for an empty set and still points current at a complete tree', async () => {
    const result = await install({}, deps);
    expect(result).toMatchObject({ tree: treeName([]), npm: null, reused: false, count: 0 });
    expect(readdirSync(join(dir, 'trees', result.tree)).sort()).toEqual([
      '.complete',
      'package.json',
    ]);
    expect(deps.prepareNpm).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false);
    expect((await install({}, deps)).reused).toBe(true);
  });

  it('on npm failure keeps current, removes the staged tree and quotes npm (R11)', async () => {
    const good = await install(TWO, deps);
    const lines = Array.from({ length: 30 }, (_, i) => `npm error line ${i}`).join('\n');
    npm = fakeNpm({ code: 1, stderr: lines });
    const failing = install({ ...TWO, '@agentage/fixture-missing': '^1' }, deps);
    await expect(failing).rejects.toThrow(
      /^npm install failed \(exit 1\); plugins\/current is unchanged\nnpm error line 10\n/
    );
    await failing.catch((err: Error) => {
      expect(err.message.split('\n')).toHaveLength(21);
      expect(err.message.endsWith('npm error line 29')).toBe(true);
    });
    expect(read('current')).toBe(`${good.tree}\n`);
    expect(trees()).toEqual([good.tree]);
    expect(JSON.parse(read('package.json'))).toMatchObject({ dependencies: TWO });
  });

  it('fails when npm succeeds but writes no lock', async () => {
    npm.npm.run = async () => ({ code: 0, stdout: '', stderr: '' });
    await expect(install(TWO, deps)).rejects.toThrow('npm install wrote no usable package-lock');
    expect(trees()).toEqual([]);
    expect(existsSync(join(dir, 'current'))).toBe(false);
  });

  it('refuses a name outside the scopes or a bad spec before taking the lock (R10)', async () => {
    await expect(install({ '@acme/x': '^1', [HELLO]: 'file:../x' }, deps)).rejects.toThrow(
      /plugins\["@acme\/x"\]: refused by the scope rule.*\nplugins\["@agentage\/fixture-hello"\]: file:/
    );
    expect(deps.lock).not.toHaveBeenCalled();
    expect(() => checkInstallSet({ [HELLO]: '^1' }, deps)).not.toThrow();
  });

  it('keeps the last lines of npm output, skipping blanks', () => {
    expect(lastLines('a\n\nb\r\nc\n', 2)).toBe('b\nc');
    expect(lastLines('')).toBe('');
  });

  it('default deps read the plugins dir and the npm env', () => {
    process.env['AGENTAGE_PLUGINS_DIR'] = dir;
    process.env['AGENTAGE_NPM_REGISTRY'] = 'http://127.0.0.1:1';
    try {
      expect(planInstall({}, defaultInstallerDeps)).toMatchObject({
        pluginsDir: dir,
        registry: 'http://127.0.0.1:1',
      });
      expect(defaultInstallerDeps.scopes()).toEqual(['@agentage']);
    } finally {
      delete process.env['AGENTAGE_PLUGINS_DIR'];
      delete process.env['AGENTAGE_NPM_REGISTRY'];
    }
  });
});
