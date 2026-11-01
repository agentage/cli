import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatherExtensions, invalidProfileError } from './rows.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures');
const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const RUN = { at: '2026-10-29T10:00:00.000Z', pid: 7, state: 'ok', error: null };

// The installed and off/blocked rows are proven end to end in e2e/core/extension-list.test.ts.
describe('gatherExtensions (T19)', () => {
  let cfg: string;

  const writeJson = (rel: string, value: unknown): void => {
    mkdirSync(join(cfg, rel, '..'), { recursive: true });
    writeFileSync(join(cfg, rel), JSON.stringify(value));
  };

  const placeTree = (extensionsDir: string, fixtures: string[]): void => {
    const tree = join(extensionsDir, 'trees', 'x');
    for (const f of fixtures) {
      const target = join(tree, 'node_modules', '@agentage', `fixture-${f}`);
      cpSync(join(FIXTURES, `extension-${f}`), target, { recursive: true });
    }
    writeFileSync(join(tree, '.complete'), '');
    writeFileSync(join(extensionsDir, 'current'), 'x\n');
  };

  beforeEach(() => {
    cfg = mkdtempSync(join(tmpdir(), 'agentage-rows-'));
    process.env['AGENTAGE_CONFIG_DIR'] = cfg;
    delete process.env['AGENTAGE_EXTENSIONS_DIR'];
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    delete process.env['AGENTAGE_EXTENSIONS_DIR'];
    rmSync(cfg, { recursive: true, force: true });
  });

  it('hides another claimant run from an invalid row and honours AGENTAGE_EXTENSIONS_DIR', async () => {
    const extensionsDir = join(cfg, 'elsewhere');
    process.env['AGENTAGE_EXTENSIONS_DIR'] = extensionsDir;
    placeTree(extensionsDir, ['hello', 'dup-id']);
    const extensions = { [HELLO]: '^1', '@agentage/fixture-dup-id': '^1' };
    writeJson('profile.json', { version: 1, extensions, extra: true });
    writeJson('state/hello.json', RUN);
    const { status, warnings } = await gatherExtensions();
    expect(status.extensions.map((r) => [r.state, r.lastRun])).toEqual([
      ['invalid', null],
      ['invalid', null],
    ]);
    expect(warnings).toEqual(['profile.json: unknown key "extra" kept']);
  });

  it('lists dev extensions as dev rows and reports an invalid profile', async () => {
    const devDir = join(cfg, 'dev-hello');
    cpSync(join(FIXTURES, 'extension-hello'), devDir, { recursive: true });
    const machine = { id: 'm_0000beef', name: 'box', dev: { [HELLO]: devDir } };
    writeJson('machine.json', { ...machine, profileSource: 'default' });
    writeJson('profile.json', { version: 1, extensions: { [WORLD]: 'file:../x' } });
    const { status } = await gatherExtensions();
    const error = `extensions["${WORLD}"]: file: specs are refused; use a semver range or an https: tarball URL`;
    expect(status.profile).toEqual({ state: 'invalid', errors: [error] });
    expect(String(invalidProfileError(status.profile))).toContain(`invalid:\n  ${error}`);
    expect(status.extensions).toEqual([
      expect.objectContaining({ id: 'hello', mode: 'dev', wanted: null, state: 'installed' }),
    ]);
  });
});
