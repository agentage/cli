import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import { addVault } from './vault-registry.js';
import { ensureConfigDir, getConfigDir } from './config.js';
import {
  ensureVaultsConfig,
  loadVaultsConfig,
  mutateVaultsConfig,
  saveVaultsConfig,
  vaultsJsonPath,
} from './vaults.js';

const SCHEMA = 'https://agentage.io/schemas/vaults.schema.json';

const write = (path: string, text: string): void => {
  ensureConfigDir();
  writeFileSync(path, text);
};

describe('vaults config store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-vaults-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty config when no file exists (zero-config)', () => {
    expect(loadVaultsConfig()).toEqual({ config: { version: 1, vaults: {} }, source: null });
  });

  it('loads and validates the unified object-map shape', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 1, vaults: { work: { path: '~/w' } } }));
    const { config, source } = loadVaultsConfig();
    expect(config.vaults?.work).toMatchObject({ path: '~/w' });
    expect(source).toBe(vaultsJsonPath());
  });

  it('rejects an entry with neither path nor origin', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 1, vaults: { x: {} } }));
    expect(() => loadVaultsConfig()).toThrow(/origin and\/or a path/);
  });

  it('rejects a version other than 1', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 2 }));
    expect(() => loadVaultsConfig()).toThrow();
  });

  it('round-trips a save: $schema first, 0600, trailing newline, default preserved', () => {
    const config: VaultsConfig = {
      version: 1,
      default: 'work',
      vaults: { work: { path: '~/w', mcp: ['local'] } },
    };
    const path = saveVaultsConfig(config);
    const raw = readFileSync(path, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)[0]).toBe('$schema');
    expect(parsed.$schema).toBe(SCHEMA);
    expect(parsed.default).toBe('work');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadVaultsConfig().config.vaults).toEqual(config.vaults);
  });

  it('preserves the discover roots through a save round-trip', () => {
    const config: VaultsConfig = {
      version: 1,
      discover: [{ path: '~/roots', autosync: false, ignore: ['skip'] }],
      vaults: { work: { path: '~/w', mcp: ['local'] } },
    };
    saveVaultsConfig(config);
    expect(loadVaultsConfig().config.discover).toEqual(config.discover);
  });

  it('always rewrites the canonical $schema url on save', () => {
    const path = saveVaultsConfig({ $schema: 'https://evil/x.json', version: 1, vaults: {} });
    expect(JSON.parse(readFileSync(path, 'utf-8'))['$schema']).toBe(SCHEMA);
  });

  // Per-save unique tmp names make cross-process tmp clobbering structurally impossible.
  it('rapid successive saves never throw and the survivor is valid JSON', () => {
    let path = '';
    for (let i = 0; i < 25; i++) {
      path = saveVaultsConfig({ version: 1, vaults: { [`v${i}`]: { path: `/tmp/v${i}` } } });
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { vaults: Record<string, unknown> };
    expect(Object.keys(parsed.vaults)).toEqual(['v24']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('scaffolds an empty, $schema-linked vaults.json when none exists', () => {
    ensureVaultsConfig();
    expect(JSON.parse(readFileSync(vaultsJsonPath(), 'utf-8'))).toEqual({
      $schema: SCHEMA,
      version: 1,
      vaults: {},
    });
  });

  it('leaves an existing vaults.json untouched when scaffolding', () => {
    const original = JSON.stringify({ version: 1, vaults: {} });
    write(vaultsJsonPath(), original);
    ensureVaultsConfig();
    expect(readFileSync(vaultsJsonPath(), 'utf-8')).toBe(original);
  });
});

describe('mutateVaultsConfig (cross-process locked read-modify-write)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-mutate-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(dir, 'cfg');
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies the mutation and returns the saved config', async () => {
    const next = await mutateVaultsConfig((cfg) => addVault(cfg, 'work', { path: '~/w' }));
    expect(next.vaults?.work).toMatchObject({ path: '~/w' });
    expect(loadVaultsConfig().config.vaults?.work).toMatchObject({ path: '~/w' });
  });

  it('leaves the file untouched when fn returns null (no-op skip)', async () => {
    saveVaultsConfig({ version: 1, vaults: { a: { path: '/a' } } });
    const before = readFileSync(vaultsJsonPath(), 'utf-8');
    const result = await mutateVaultsConfig(() => null);
    expect(result.vaults?.a).toMatchObject({ path: '/a' });
    expect(readFileSync(vaultsJsonPath(), 'utf-8')).toBe(before);
  });

  it('releases the lock and leaves no lockfile when fn throws', async () => {
    await expect(
      mutateVaultsConfig(() => {
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');
    expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });

  it('folds 20 concurrent in-process mutations together, losing none', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateVaultsConfig((cfg) => addVault(cfg, `v${i}`, { path: `/tmp/v${i}` }))
      )
    );
    const names = Object.keys(loadVaultsConfig().config.vaults ?? {}).sort();
    expect(names).toEqual(Array.from({ length: 20 }, (_, i) => `v${i}`).sort());
    expect(readdirSync(getConfigDir()).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });

  it('re-reads FRESH under the lock: a mutation sees a write that landed after its own load', async () => {
    // Both mutators start from the same empty outer view; the second to run must still see the
    // first's write (fresh re-read), else its save would clobber it and one vault would be lost.
    await Promise.all([
      mutateVaultsConfig((cfg) => addVault(cfg, 'first', { path: '/first' })),
      mutateVaultsConfig((cfg) => addVault(cfg, 'second', { path: '/second' })),
    ]);
    const names = Object.keys(loadVaultsConfig().config.vaults ?? {}).sort();
    expect(names).toEqual(['first', 'second']);
  });
});
