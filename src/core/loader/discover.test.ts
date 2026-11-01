import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentTree, discover, type DiscoveredExtension } from './discover.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const OLD = '@agentage/fixture-old-engine';
const DUP = '@agentage/fixture-dup-id';

describe('discover (T14)', () => {
  let root: string;
  let extensionsDir: string;
  let nodeModules: string;

  const place = (fixture: string, name = `fixture-${fixture}`): string => {
    const dir = join(nodeModules, '@agentage', name);
    cpSync(join(FIXTURES, `extension-${fixture}`), dir, { recursive: true });
    return dir;
  };

  const writePackage = (dir: string, manifest: Record<string, unknown>): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  };

  const byPkg = (extensions: DiscoveredExtension[], pkg: string): DiscoveredExtension | undefined =>
    extensions.find((p) => p.pkg === pkg);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentage-discover-'));
    extensionsDir = join(root, 'extensions');
    nodeModules = join(extensionsDir, 'trees', 't1', 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(extensionsDir, 'trees', 't1', '.complete'), '');
    writeFileSync(join(extensionsDir, 'current'), 't1\n');
    for (const f of ['hello', 'world', 'old-engine', 'dup-id']) place(f);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads tree manifests: versions, ids, commands, entry path', () => {
    const { extensions, warnings } = discover({ extensionsDir, names: [HELLO, WORLD], dev: {} });
    expect(warnings).toEqual([]);
    expect(byPkg(extensions, HELLO)).toMatchObject({
      source: 'tree',
      version: '1.0.0',
      id: 'hello',
      commands: ['hello'],
      entry: join(nodeModules, '@agentage', 'fixture-hello', 'index.js'),
      problem: null,
      missing: false,
    });
    expect(byPkg(extensions, WORLD)).toMatchObject({ id: 'world', peers: [HELLO], problem: null });
  });

  it('marks a bad engine and both duplicate-id claimants invalid', () => {
    const { extensions } = discover({ extensionsDir, names: [HELLO, OLD, DUP], dev: {} });
    expect(byPkg(extensions, OLD)?.problem).toContain('engines.agentage "^0.1" does not match');
    expect(byPkg(extensions, HELLO)?.problem).toBe(`duplicate id "hello" (also ${DUP})`);
    expect(byPkg(extensions, DUP)?.problem).toBe(`duplicate id "hello" (also ${HELLO})`);
  });

  it('never imports an extension entry', () => {
    const marker = join(root, 'imported');
    const dir = place('hello');
    writeFileSync(
      join(dir, 'index.js'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`
    );
    const { extensions } = discover({ extensionsDir, names: [HELLO], dev: {} });
    expect(byPkg(extensions, HELLO)?.problem).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('lets a dev extension with the same package name replace the installed one', () => {
    const devDir = join(root, 'dev-hello');
    cpSync(join(FIXTURES, 'extension-hello'), devDir, { recursive: true });
    const { extensions } = discover({ extensionsDir, names: [HELLO], dev: { [HELLO]: devDir } });
    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toMatchObject({ source: 'dev', dir: devDir, problem: null });
  });

  it('a dev extension with another package name but the same id is a duplicate', () => {
    const devDir = join(root, 'dev-dup');
    cpSync(join(FIXTURES, 'extension-dup-id'), devDir, { recursive: true });
    const { extensions } = discover({ extensionsDir, names: [HELLO], dev: { [DUP]: devDir } });
    expect(extensions.map((p) => p.problem)).toEqual([
      `duplicate id "hello" (also ${DUP})`,
      `duplicate id "hello" (also ${HELLO})`,
    ]);
  });

  it('reports missing packages and bad dev paths without throwing', () => {
    const dev = { '@agentage/rel': 'relative/path', '@agentage/gone': join(root, 'nope') };
    const { extensions } = discover({ extensionsDir, names: ['@agentage/absent'], dev });
    expect(byPkg(extensions, '@agentage/absent')).toMatchObject({ missing: true, source: 'tree' });
    expect(byPkg(extensions, '@agentage/rel')?.problem).toBe('dev path not absolute');
    expect(byPkg(extensions, '@agentage/gone')).toMatchObject({ missing: true, source: 'dev' });
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
    const { extensions } = discover({
      extensionsDir,
      names: ['esc', 'nofile', 'noentry', 'broken'],
      dev: {},
    });
    expect(byPkg(extensions, 'esc')?.problem).toBe('entry ../x.js is outside the package');
    expect(byPkg(extensions, 'nofile')?.problem).toBe('entry x.js not found');
    expect(byPkg(extensions, 'noentry')?.problem).toBe('no entry point (exports or main)');
    expect(byPkg(extensions, 'broken')?.missing).toBe(true);
  });

  it('keeps extension peers, drops library peers, keeps unknown peers', () => {
    writePackage(join(nodeModules, 'lib'), { name: 'lib', version: '1.0.0' });
    writePackage(join(nodeModules, 'p'), {
      name: 'p',
      main: 'package.json',
      agentage: { id: 'p' },
      peerDependencies: { lib: '^1', [HELLO]: '^1', [WORLD]: '^1', '@agentage/absent': '^1' },
    });
    const { extensions } = discover({ extensionsDir, names: ['p', WORLD], dev: {} });
    expect(byPkg(extensions, 'p')?.peers).toEqual([HELLO, WORLD, '@agentage/absent']);
  });

  it('without a complete current tree every profile extension is missing', () => {
    rmSync(join(extensionsDir, 'trees', 't1', '.complete'));
    const result = discover({ extensionsDir, names: [WORLD], dev: {} });
    expect(result.warnings).toEqual(['extensions tree "t1" is incomplete and was ignored']);
    expect(result.extensions[0]).toMatchObject({ missing: true, peers: [] });
  });

  it('resolves the current pointer defensively', () => {
    expect(currentTree(join(root, 'empty'))).toEqual({ dir: null, warning: null });
    writeFileSync(join(extensionsDir, 'current'), '../escape');
    expect(currentTree(extensionsDir).warning).toBe('extensions/current: bad tree "../escape"');
    writeFileSync(join(extensionsDir, 'current'), 't1');
    expect(currentTree(extensionsDir)).toEqual({
      dir: join(extensionsDir, 'trees', 't1'),
      warning: null,
    });
  });
});
