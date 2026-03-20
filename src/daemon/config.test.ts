import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-config-${Date.now()}`);

describe('config', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates default config on first run', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.machine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(config.daemon.port).toBe(4243);
    expect(config.discovery.dirs).toHaveLength(2);
    expect(existsSync(join(testDir, 'config.json'))).toBe(true);
  });

  it('generates machine ID as UUID v4', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.machine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('loads existing config without overwriting', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    const originalId = config.machine.id;

    // Load again — should return same config
    const config2 = loadConfig();
    expect(config2.machine.id).toBe(originalId);
  });

  it('default discovery dirs include agents and skills', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    const agentsDir = config.discovery.dirs.find((d) => d.endsWith('/agents'));
    const skillsDir = config.discovery.dirs.find((d) => d.endsWith('/skills'));
    expect(agentsDir).toBeDefined();
    expect(skillsDir).toBeDefined();
  });

  it('respects AGENTAGE_CONFIG_DIR', async () => {
    const { getConfigDir } = await import('./config.js');
    expect(getConfigDir()).toBe(testDir);
  });

  it('saves and loads config', async () => {
    const { loadConfig, saveConfig } = await import('./config.js');
    const config = loadConfig();
    config.daemon.port = 9999;
    saveConfig(config);

    const raw = readFileSync(join(testDir, 'config.json'), 'utf-8');
    const loaded = JSON.parse(raw);
    expect(loaded.daemon.port).toBe(9999);
  });

  it('creates config dir if it does not exist', async () => {
    const nested = join(testDir, 'nested', 'deep');
    process.env['AGENTAGE_CONFIG_DIR'] = nested;

    const { getConfigDir } = await import('./config.js');
    const dir = getConfigDir();
    expect(dir).toBe(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('machine name defaults to hostname', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.machine.name).toBeTruthy();
    expect(typeof config.machine.name).toBe('string');
  });
});
