import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = join(tmpdir(), `agentage-test-config-${Date.now()}`);

describe('config', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    delete process.env['AGENTAGE_AGENTS_DIR'];
    delete process.env['AGENTAGE_PROJECTS_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates default config on first run', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.machine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(config.daemon.port).toBe(4243);
    expect(config.agents.default).toBe(join(homedir(), 'agents'));
    expect(config.agents.additional).toEqual([]);
    expect(config.projects.default).toBe(join(homedir(), 'projects'));
    expect(config.projects.additional).toEqual([]);
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

    const config2 = loadConfig();
    expect(config2.machine.id).toBe(originalId);
  });

  it('default agents dir is homedir()/agents', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.agents.default).toBe(join(homedir(), 'agents'));
  });

  it('default projects dir is homedir()/projects', async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.projects.default).toBe(join(homedir(), 'projects'));
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

  it('AGENTAGE_PORT overrides daemon port', async () => {
    process.env['AGENTAGE_PORT'] = '5555';
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.daemon.port).toBe(5555);
    delete process.env['AGENTAGE_PORT'];
  });

  it('AGENTAGE_AGENTS_DIR overrides agents.default (in-memory, not persisted)', async () => {
    process.env['AGENTAGE_AGENTS_DIR'] = '/tmp/custom-agents';
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.agents.default).toBe('/tmp/custom-agents');

    const raw = readFileSync(join(testDir, 'config.json'), 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved.agents.default).toBe(join(homedir(), 'agents'));
  });

  it('AGENTAGE_PROJECTS_DIR overrides projects.default (in-memory, not persisted)', async () => {
    process.env['AGENTAGE_PROJECTS_DIR'] = '/tmp/custom-projects';
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    expect(config.projects.default).toBe('/tmp/custom-projects');

    const raw = readFileSync(join(testDir, 'config.json'), 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved.projects.default).toBe(join(homedir(), 'projects'));
  });

  it('getAgentsDirs returns [default, ...additional] deduped', async () => {
    const { loadConfig, getAgentsDirs } = await import('./config.js');
    const config = loadConfig();
    config.agents.default = '/a';
    config.agents.additional = ['/b', '/a', '/c'];
    expect(getAgentsDirs(config)).toEqual(['/a', '/b', '/c']);
  });

  it('getProjectsDirs returns [default, ...additional] deduped', async () => {
    const { loadConfig, getProjectsDirs } = await import('./config.js');
    const config = loadConfig();
    config.projects.default = '/a';
    config.projects.additional = ['/b', '/a'];
    expect(getProjectsDirs(config)).toEqual(['/a', '/b']);
  });
});
