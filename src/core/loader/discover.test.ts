import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentTree, discover, type DiscoveredModule } from './discover.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const OLD = '@agentage/fixture-old-engine';
const DUP = '@agentage/fixture-dup-id';

describe('discover (T14)', () => {
  let root: string;
  let modulesDir: string;
  let nodeModules: string;

  const place = (fixture: string, name = `fixture-${fixture}`): string => {
    const dir = join(nodeModules, '@agentage', name);
    cpSync(join(FIXTURES, `module-${fixture}`), dir, { recursive: true });
    return dir;
  };

  const writePackage = (dir: string, manifest: Record<string, unknown>): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  };

  const byPkg = (modules: DiscoveredModule[], pkg: string): DiscoveredModule | undefined =>
    modules.find((p) => p.pkg === pkg);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentage-discover-'));
    modulesDir = join(root, 'modules');
    nodeModules = join(modulesDir, 'trees', 't1', 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(modulesDir, 'trees', 't1', '.complete'), '');
    writeFileSync(join(modulesDir, 'current'), 't1\n');
    for (const f of ['hello', 'world', 'old-engine', 'dup-id']) place(f);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads tree manifests: versions, ids, commands, entry path', () => {
    const { modules, warnings } = discover({ modulesDir, names: [HELLO, WORLD], dev: {} });
    expect(warnings).toEqual([]);
    expect(byPkg(modules, HELLO)).toMatchObject({
      source: 'tree',
      version: '1.0.0',
      id: 'hello',
      commands: ['hello'],
      entry: join(nodeModules, '@agentage', 'fixture-hello', 'index.js'),
      problem: null,
      missing: false,
    });
    expect(byPkg(modules, WORLD)).toMatchObject({ id: 'world', peers: [HELLO], problem: null });
  });

  it('marks a bad engine and both duplicate-id claimants invalid', () => {
    const { modules } = discover({ modulesDir, names: [HELLO, OLD, DUP], dev: {} });
    expect(byPkg(modules, OLD)?.problem).toContain('engines.agentage "^0.1" does not match');
    expect(byPkg(modules, HELLO)?.problem).toBe(`duplicate id "hello" (also ${DUP})`);
    expect(byPkg(modules, DUP)?.problem).toBe(`duplicate id "hello" (also ${HELLO})`);
  });

  it('never imports a module entry', () => {
    const marker = join(root, 'imported');
    const dir = place('hello');
    writeFileSync(
      join(dir, 'index.js'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`
    );
    const { modules } = discover({ modulesDir, names: [HELLO], dev: {} });
    expect(byPkg(modules, HELLO)?.problem).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('lets a dev module with the same package name replace the installed one', () => {
    const devDir = join(root, 'dev-hello');
    cpSync(join(FIXTURES, 'module-hello'), devDir, { recursive: true });
    const { modules } = discover({ modulesDir, names: [HELLO], dev: { [HELLO]: devDir } });
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ source: 'dev', dir: devDir, problem: null });
  });

  it('a dev module with another package name but the same id is a duplicate', () => {
    const devDir = join(root, 'dev-dup');
    cpSync(join(FIXTURES, 'module-dup-id'), devDir, { recursive: true });
    const { modules } = discover({ modulesDir, names: [HELLO], dev: { [DUP]: devDir } });
    expect(modules.map((p) => p.problem)).toEqual([
      `duplicate id "hello" (also ${DUP})`,
      `duplicate id "hello" (also ${HELLO})`,
    ]);
  });

  it('reports missing packages and bad dev paths without throwing', () => {
    const dev = { '@agentage/rel': 'relative/path', '@agentage/gone': join(root, 'nope') };
    const { modules } = discover({ modulesDir, names: ['@agentage/absent'], dev });
    expect(byPkg(modules, '@agentage/absent')).toMatchObject({ missing: true, source: 'tree' });
    expect(byPkg(modules, '@agentage/rel')?.problem).toBe('dev path not absolute');
    expect(byPkg(modules, '@agentage/gone')).toMatchObject({ missing: true, source: 'dev' });
  });

  it('flags entries that escape the package or do not exist', () => {
    writePackage(join(nodeModules, 'esc'), {
      name: 'esc',
      agentage: { id: 'esc' },
      main: '../x.js',
    });
    writePackage(join(nodeModules, 'nofile'), {
      name: 'nofile',
      agentage: { id: 'nofile' },
      main: 'x.js',
    });
    writePackage(join(nodeModules, 'noentry'), { name: 'noentry', agentage: { id: 'noentry' } });
    mkdirSync(join(nodeModules, 'broken'));
    writeFileSync(join(nodeModules, 'broken', 'package.json'), '{ nope');
    const { modules } = discover({
      modulesDir,
      names: ['esc', 'nofile', 'noentry', 'broken'],
      dev: {},
    });
    expect(byPkg(modules, 'esc')?.problem).toBe('entry ../x.js is outside the package');
    expect(byPkg(modules, 'nofile')?.problem).toBe('entry x.js not found');
    expect(byPkg(modules, 'noentry')?.problem).toBe('no entry point (exports or main)');
    expect(byPkg(modules, 'broken')?.missing).toBe(true);
  });

  it('keeps module peers, drops library peers, keeps unknown peers', () => {
    writePackage(join(nodeModules, 'lib'), { name: 'lib', version: '1.0.0' });
    writePackage(join(nodeModules, 'p'), {
      name: 'p',
      main: 'package.json',
      agentage: { id: 'p' },
      peerDependencies: { lib: '^1', [HELLO]: '^1', [WORLD]: '^1', '@agentage/absent': '^1' },
    });
    const { modules } = discover({ modulesDir, names: ['p', WORLD], dev: {} });
    expect(byPkg(modules, 'p')?.peers).toEqual([HELLO, WORLD, '@agentage/absent']);
  });

  it('without a complete current tree every profile module is missing', () => {
    rmSync(join(modulesDir, 'trees', 't1', '.complete'));
    const result = discover({ modulesDir, names: [WORLD], dev: {} });
    expect(result.warnings).toEqual(['modules tree "t1" is incomplete and was ignored']);
    expect(result.modules[0]).toMatchObject({ missing: true, peers: [] });
  });

  it('resolves the current pointer defensively', () => {
    expect(currentTree(join(root, 'empty'))).toEqual({ dir: null, warning: null });
    writeFileSync(join(modulesDir, 'current'), '../escape');
    expect(currentTree(modulesDir).warning).toBe('modules/current: bad tree "../escape"');
    writeFileSync(join(modulesDir, 'current'), 't1');
    expect(currentTree(modulesDir)).toEqual({
      dir: join(modulesDir, 'trees', 't1'),
      warning: null,
    });
  });
});
