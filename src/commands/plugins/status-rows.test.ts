import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatherPluginStatus } from './status-rows.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const OLD = '@agentage/fixture-old-engine';
const MACHINE_ID = 'm_0000beef';
const RUN = { at: '2026-10-29T10:00:00.000Z', pid: 7, state: 'ok', error: null };

const listTree = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = `${prefix}${e.name}`;
    return e.isDirectory() ? [rel, ...listTree(join(dir, e.name), `${rel}/`)] : [rel];
  });

describe('gatherPluginStatus (T19)', () => {
  let cfg: string;

  const writeJson = (rel: string, value: unknown): void => {
    mkdirSync(join(cfg, rel, '..'), { recursive: true });
    writeFileSync(join(cfg, rel), JSON.stringify(value));
  };

  const placeTree = (pluginsDir: string, fixtures: string[]): void => {
    const tree = join(pluginsDir, 'trees', 'x');
    for (const f of fixtures)
      cpSync(
        join(FIXTURES, `plugin-${f}`),
        join(tree, 'node_modules', '@agentage', `fixture-${f}`),
        {
          recursive: true,
        }
      );
    writeFileSync(join(tree, '.complete'), '');
    writeFileSync(join(pluginsDir, 'current'), 'x\n');
  };

  beforeEach(() => {
    cfg = mkdtempSync(join(tmpdir(), 'agentage-rows-'));
    process.env['AGENTAGE_CONFIG_DIR'] = cfg;
    delete process.env['AGENTAGE_PLUGINS_DIR'];
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    delete process.env['AGENTAGE_PLUGINS_DIR'];
    rmSync(cfg, { recursive: true, force: true });
  });

  it('with no profile reports it and lists no plugins, writing only machine.json', async () => {
    const { status, warnings } = await gatherPluginStatus();
    expect(status.profile).toEqual({ state: 'missing' });
    expect(status.plugins).toEqual([]);
    expect(status.machine.id).toMatch(/^m_[0-9a-f]{8}$/);
    expect(warnings).toEqual([]);
    expect(readdirSync(cfg)).toEqual(['machine.json']);
  });

  const seedThree = (): void => {
    placeTree(join(cfg, 'plugins'), ['hello', 'world', 'old-engine']);
    writeJson('machine.json', { id: MACHINE_ID, name: 'box' });
    writeJson('profile.json', {
      version: 1,
      plugins: { [WORLD]: '^1', [HELLO]: '^1.0.0', [OLD]: '*' },
      machines: { [MACHINE_ID]: { off: [] } },
      extra: true,
    });
    writeJson('state/hello.json', RUN);
  };

  it('builds rows from tree manifests, the profile and state files', async () => {
    seedThree();
    const { status, warnings } = await gatherPluginStatus();
    expect(warnings).toEqual(['profile.json: unknown key "extra" kept']);
    expect(status.machine).toEqual({ id: MACHINE_ID, name: 'box' });
    expect(status.profile).toEqual({ state: 'ok', version: 1, source: 'default', readOnly: false });
    expect(status.plugins.map((r) => [r.id, r.state, r.installed, r.wanted])).toEqual([
      ['hello', 'installed', '1.0.0', '^1.0.0'],
      ['oldengine', 'invalid', '1.0.0', '*'],
      ['world', 'installed', '1.0.0', '^1'],
    ]);
    const lastRun = { at: RUN.at, state: 'ok', error: null };
    expect(status.plugins[0]).toMatchObject({ commands: ['hello'], mode: 'installed', lastRun });
    expect(status.plugins[2]).toMatchObject({ commands: ['world'], lastRun: null });
    expect(status.plugins[1]?.error).toContain('does not match plugin API');
  });

  it('writes nothing but the completed legacy machine.json', async () => {
    seedThree();
    const before = listTree(cfg);
    await gatherPluginStatus();
    expect(listTree(cfg)).toEqual(before);
    expect(JSON.parse(readFileSync(join(cfg, 'machine.json'), 'utf-8'))).toEqual({
      id: MACHINE_ID,
      name: 'box',
      dev: {},
      profileSource: 'default',
    });
  });

  it('applies off for this machine and blocks the dependent', async () => {
    placeTree(join(cfg, 'plugins'), ['hello', 'world']);
    writeJson('machine.json', { id: MACHINE_ID, name: 'box', dev: {}, profileSource: 'file' });
    writeJson('profile.json', {
      version: 1,
      plugins: { [HELLO]: '^1', [WORLD]: '^1' },
      machines: { [MACHINE_ID]: { off: [HELLO] } },
    });
    const { status } = await gatherPluginStatus();
    expect(status.profile).toMatchObject({ source: 'file' });
    expect(status.plugins.map((r) => [r.id, r.state, r.error])).toEqual([
      ['hello', 'off', null],
      ['world', 'blocked', `peer ${HELLO} is off`],
    ]);
  });

  it('hides another claimant run from an invalid row and honours AGENTAGE_PLUGINS_DIR', async () => {
    const pluginsDir = join(cfg, 'elsewhere');
    process.env['AGENTAGE_PLUGINS_DIR'] = pluginsDir;
    placeTree(pluginsDir, ['hello', 'dup-id']);
    writeJson('profile.json', {
      version: 1,
      plugins: { [HELLO]: '^1', '@agentage/fixture-dup-id': '^1' },
    });
    writeJson('state/hello.json', RUN);
    const { status } = await gatherPluginStatus();
    expect(status.plugins.map((r) => [r.state, r.lastRun])).toEqual([
      ['invalid', null],
      ['invalid', null],
    ]);
  });

  it('lists dev plugins as dev rows and reports an invalid profile', async () => {
    const devDir = join(cfg, 'dev-hello');
    cpSync(join(FIXTURES, 'plugin-hello'), devDir, { recursive: true });
    writeJson('machine.json', { id: MACHINE_ID, name: 'box', dev: { [HELLO]: devDir } });
    writeJson('profile.json', { version: 1, plugins: { [WORLD]: 'file:../x' } });
    const { status } = await gatherPluginStatus();
    expect(status.profile).toEqual({
      state: 'invalid',
      errors: [
        `plugins["${WORLD}"]: file: specs are refused; use a semver range or an https: tarball URL`,
      ],
    });
    expect(status.plugins).toEqual([
      expect.objectContaining({ id: 'hello', mode: 'dev', wanted: null, state: 'installed' }),
    ]);
  });
});
