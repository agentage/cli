import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentTree, discover, type DiscoveredPlugin } from './discover.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const OLD = '@agentage/fixture-old-engine';
const DUP = '@agentage/fixture-dup-id';

describe('discover (T14)', () => {
  let root: string;
  let pluginsDir: string;
  let modules: string;

  const place = (fixture: string, name = `fixture-${fixture}`): string => {
    const dir = join(modules, '@agentage', name);
    cpSync(join(FIXTURES, `plugin-${fixture}`), dir, { recursive: true });
    return dir;
  };

  const writePackage = (dir: string, manifest: Record<string, unknown>): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  };

  const byPkg = (plugins: DiscoveredPlugin[], pkg: string): DiscoveredPlugin | undefined =>
    plugins.find((p) => p.pkg === pkg);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentage-discover-'));
    pluginsDir = join(root, 'plugins');
    modules = join(pluginsDir, 'trees', 't1', 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(pluginsDir, 'trees', 't1', '.complete'), '');
    writeFileSync(join(pluginsDir, 'current'), 't1\n');
    for (const f of ['hello', 'world', 'old-engine', 'dup-id']) place(f);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads tree manifests: versions, ids, commands, entry path', () => {
    const { plugins, warnings } = discover({ pluginsDir, names: [HELLO, WORLD], dev: {} });
    expect(warnings).toEqual([]);
    expect(byPkg(plugins, HELLO)).toMatchObject({
      source: 'tree',
      version: '1.0.0',
      id: 'hello',
      commands: ['hello'],
      entry: join(modules, '@agentage', 'fixture-hello', 'index.js'),
      problem: null,
      missing: false,
    });
    expect(byPkg(plugins, WORLD)).toMatchObject({ id: 'world', peers: [HELLO], problem: null });
  });

  it('marks a bad engine and both duplicate-id claimants invalid', () => {
    const { plugins } = discover({ pluginsDir, names: [HELLO, OLD, DUP], dev: {} });
    expect(byPkg(plugins, OLD)?.problem).toContain('engines.agentage "^0.1" does not match');
    expect(byPkg(plugins, HELLO)?.problem).toBe(`duplicate id "hello" (also ${DUP})`);
    expect(byPkg(plugins, DUP)?.problem).toBe(`duplicate id "hello" (also ${HELLO})`);
  });

  it('never imports a plugin entry', () => {
    const marker = join(root, 'imported');
    const dir = place('hello');
    writeFileSync(
      join(dir, 'index.js'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`
    );
    const { plugins } = discover({ pluginsDir, names: [HELLO], dev: {} });
    expect(byPkg(plugins, HELLO)?.problem).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('lets a dev plugin with the same package name replace the installed one', () => {
    const devDir = join(root, 'dev-hello');
    cpSync(join(FIXTURES, 'plugin-hello'), devDir, { recursive: true });
    const { plugins } = discover({ pluginsDir, names: [HELLO], dev: { [HELLO]: devDir } });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({ source: 'dev', dir: devDir, problem: null });
  });

  it('a dev plugin with another package name but the same id is a duplicate', () => {
    const devDir = join(root, 'dev-dup');
    cpSync(join(FIXTURES, 'plugin-dup-id'), devDir, { recursive: true });
    const { plugins } = discover({ pluginsDir, names: [HELLO], dev: { [DUP]: devDir } });
    expect(plugins.map((p) => p.problem)).toEqual([
      `duplicate id "hello" (also ${DUP})`,
      `duplicate id "hello" (also ${HELLO})`,
    ]);
  });

  it('reports missing packages and bad dev paths without throwing', () => {
    const dev = { '@agentage/rel': 'relative/path', '@agentage/gone': join(root, 'nope') };
    const { plugins } = discover({ pluginsDir, names: ['@agentage/absent'], dev });
    expect(byPkg(plugins, '@agentage/absent')).toMatchObject({ missing: true, source: 'tree' });
    expect(byPkg(plugins, '@agentage/rel')?.problem).toBe('dev path not absolute');
    expect(byPkg(plugins, '@agentage/gone')).toMatchObject({ missing: true, source: 'dev' });
  });

  it('flags entries that escape the package or do not exist', () => {
    writePackage(join(modules, 'esc'), { name: 'esc', agentage: { id: 'esc' }, main: '../x.js' });
    writePackage(join(modules, 'nofile'), {
      name: 'nofile',
      agentage: { id: 'nofile' },
      main: 'x.js',
    });
    writePackage(join(modules, 'noentry'), { name: 'noentry', agentage: { id: 'noentry' } });
    mkdirSync(join(modules, 'broken'));
    writeFileSync(join(modules, 'broken', 'package.json'), '{ nope');
    const { plugins } = discover({
      pluginsDir,
      names: ['esc', 'nofile', 'noentry', 'broken'],
      dev: {},
    });
    expect(byPkg(plugins, 'esc')?.problem).toBe('entry ../x.js is outside the package');
    expect(byPkg(plugins, 'nofile')?.problem).toBe('entry x.js not found');
    expect(byPkg(plugins, 'noentry')?.problem).toBe('no entry point (exports or main)');
    expect(byPkg(plugins, 'broken')?.missing).toBe(true);
  });

  it('keeps plugin peers, drops library peers, keeps unknown peers', () => {
    writePackage(join(modules, 'lib'), { name: 'lib', version: '1.0.0' });
    writePackage(join(modules, 'p'), {
      name: 'p',
      main: 'package.json',
      agentage: { id: 'p' },
      peerDependencies: { lib: '^1', [HELLO]: '^1', [WORLD]: '^1', '@agentage/absent': '^1' },
    });
    const { plugins } = discover({ pluginsDir, names: ['p', WORLD], dev: {} });
    expect(byPkg(plugins, 'p')?.peers).toEqual([HELLO, WORLD, '@agentage/absent']);
  });

  it('without a complete current tree every profile plugin is missing', () => {
    rmSync(join(pluginsDir, 'trees', 't1', '.complete'));
    const result = discover({ pluginsDir, names: [WORLD], dev: {} });
    expect(result.warnings).toEqual(['plugins tree "t1" is incomplete and was ignored']);
    expect(result.plugins[0]).toMatchObject({ missing: true, peers: [] });
  });

  it('resolves the current pointer defensively', () => {
    expect(currentTree(join(root, 'empty'))).toEqual({ dir: null, warning: null });
    writeFileSync(join(pluginsDir, 'current'), '../escape');
    expect(currentTree(pluginsDir).warning).toBe('plugins/current: bad tree "../escape"');
    writeFileSync(join(pluginsDir, 'current'), 't1');
    expect(currentTree(pluginsDir)).toEqual({
      dir: join(pluginsDir, 'trees', 't1'),
      warning: null,
    });
  });
});
