import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureConfigDir } from './config.js';
import type { VaultsConfig } from './vaults.schema.js';
import {
  ensureVaultsConfig,
  loadVaultsConfig,
  saveVaultsConfig,
  vaultsJsonPath,
  vaultsYamlPath,
} from './vaults.js';

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
    const loaded = loadVaultsConfig();
    expect(loaded).toEqual({
      config: { version: 1, discover: [], vaults: [] },
      source: null,
    });
  });

  it('loads and validates the array shape from vaults.json', () => {
    write(
      vaultsJsonPath(),
      JSON.stringify({ version: 1, vaults: [{ name: 'work', type: 'local', path: '~/w' }] })
    );
    const { config } = loadVaultsConfig();
    expect(config.vaults[0]).toMatchObject({ name: 'work', type: 'local' });
  });

  it('loads YAML from vaults.yaml', () => {
    write(
      vaultsYamlPath(),
      'version: 1\nvaults:\n  - name: work\n    type: local\n    path: ~/w\n'
    );
    const { config, source } = loadVaultsConfig();
    expect(config.vaults[0]).toMatchObject({ name: 'work' });
    expect(source).toBe(vaultsYamlPath());
  });

  it('prefers vaults.json when both files exist', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 1, vaults: [] }));
    write(vaultsYamlPath(), 'version: 1\nvaults:\n  - name: y\n    type: local\n    path: ~/y\n');
    const { config, source } = loadVaultsConfig();
    expect(source).toBe(vaultsJsonPath());
    expect(config.vaults).toHaveLength(0);
  });

  it('rejects a legacy object-map file (no migration)', () => {
    write(
      vaultsJsonPath(),
      JSON.stringify({ vaults: { work: { origin: [{ remote: 'agentage' }] } } })
    );
    expect(() => loadVaultsConfig()).toThrow();
  });

  it('throws on an unknown vault type', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 1, vaults: [{ name: 'x', type: 'ftp' }] }));
    expect(() => loadVaultsConfig()).toThrow();
  });

  it('round-trips a save with $schema first, 0600, and a trailing newline', () => {
    const config: VaultsConfig = {
      version: 1,
      discover: [],
      vaults: [{ name: 'work', type: 'local', path: '~/w' }],
    };
    const path = saveVaultsConfig(config);
    const raw = readFileSync(path, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(raw))[0]).toBe('$schema');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const { config: reloaded } = loadVaultsConfig();
    expect(reloaded.vaults).toEqual(config.vaults);
  });

  it('always rewrites the canonical $schema url on save', () => {
    const path = saveVaultsConfig({
      $schema: 'https://evil/x.json',
      version: 1,
      discover: [],
      vaults: [],
    } as VaultsConfig);
    expect(JSON.parse(readFileSync(path, 'utf-8'))['$schema']).toBe(
      'https://agentage.io/schemas/vaults.schema.json'
    );
  });

  it('scaffolds an empty, $schema-linked vaults.json when none exists', () => {
    ensureVaultsConfig();
    const raw = JSON.parse(readFileSync(vaultsJsonPath(), 'utf-8'));
    expect(raw).toEqual({
      $schema: 'https://agentage.io/schemas/vaults.schema.json',
      version: 1,
      discover: [],
      vaults: [],
    });
  });

  it('leaves an existing vaults.json untouched when scaffolding', () => {
    write(vaultsJsonPath(), JSON.stringify({ version: 1, vaults: [] }));
    ensureVaultsConfig();
    expect(readFileSync(vaultsJsonPath(), 'utf-8')).toBe(
      JSON.stringify({ version: 1, vaults: [] })
    );
  });
});
