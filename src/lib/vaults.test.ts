import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import { ensureConfigDir } from './config.js';
import {
  ensureVaultsConfig,
  loadVaultsConfig,
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

  it('always rewrites the canonical $schema url on save', () => {
    const path = saveVaultsConfig({ $schema: 'https://evil/x.json', version: 1, vaults: {} });
    expect(JSON.parse(readFileSync(path, 'utf-8'))['$schema']).toBe(SCHEMA);
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
