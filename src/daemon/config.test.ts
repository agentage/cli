import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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
    expect(existsSync(join(testDir, 'machine.json'))).toBe(true);
  });

  it('persists machine identity across config.json deletion', async () => {
    const { loadConfig } = await import('./config.js');
    const first = loadConfig();
    const originalId = first.machine.id;
    const originalName = first.machine.name;

    // Simulate user deleting (or regenerating) config.json — machine.json remains
    unlinkSync(join(testDir, 'config.json'));
    expect(existsSync(join(testDir, 'machine.json'))).toBe(true);

    // Second load: config.json regenerated, identity preserved from machine.json
    const second = loadConfig();
    expect(second.machine.id).toBe(originalId);
    expect(second.machine.name).toBe(originalName);
    expect(existsSync(join(testDir, 'config.json'))).toBe(true);
  });

  it('migrates legacy machine block from config.json into machine.json', async () => {
    const legacyId = '260d7044-b229-4afb-bbf3-40af745c3926';
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: legacyId, name: 'legacy-host' },
        daemon: { port: 4243 },
        agents: { default: '/a', additional: [] },
        projects: { default: '/p', additional: [] },
        sync: { events: {} },
      }) + '\n'
    );

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.machine.id).toBe(legacyId);
    expect(config.machine.name).toBe('legacy-host');

    const machineJson = JSON.parse(readFileSync(join(testDir, 'machine.json'), 'utf-8'));
    expect(machineJson.id).toBe(legacyId);
    expect(machineJson.name).toBe('legacy-host');
  });

  it('machine.json is authoritative over config.json when both exist', async () => {
    writeFileSync(
      join(testDir, 'machine.json'),
      JSON.stringify({ id: 'from-machine-json', name: 'auth-host' }) + '\n'
    );
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: 'from-config-json', name: 'stale-host' },
        daemon: { port: 4243 },
        agents: { default: '/a', additional: [] },
        projects: { default: '/p', additional: [] },
        sync: { events: {} },
      }) + '\n'
    );

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.machine.id).toBe('from-machine-json');
    expect(config.machine.name).toBe('auth-host');
  });

  it('saveConfig writes machine.json too', async () => {
    const { loadConfig, saveConfig } = await import('./config.js');
    const config = loadConfig();
    config.machine.name = 'renamed';
    saveConfig(config);

    const machineJson = JSON.parse(readFileSync(join(testDir, 'machine.json'), 'utf-8'));
    expect(machineJson.name).toBe('renamed');
    expect(machineJson.id).toBe(config.machine.id);
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

  // -------------------------------------------------------------------------
  // Schema validation — mirrors cli#108 (loadProjects auto-rewrite). A foreign
  // or malformed config.json must not crash the daemon; load returns a valid
  // config and rewrites the file.
  // -------------------------------------------------------------------------

  it('rewrites config.json when JSON is malformed', async () => {
    writeFileSync(join(testDir, 'config.json'), '{ this is not json');

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.daemon.port).toBe(4243);
    expect(config.agents.default).toBe(join(homedir(), 'agents'));

    const rewritten = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(rewritten.daemon.port).toBe(4243);
    expect(Array.isArray(rewritten.agents.additional)).toBe(true);
  });

  it('rewrites config.json when shape is partial / foreign', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ unrelated: 'shape', no_agents: true }) + '\n'
    );

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.agents.default).toBe(join(homedir(), 'agents'));
    expect(config.projects.default).toBe(join(homedir(), 'projects'));
    expect(config.daemon.port).toBe(4243);

    const rewritten = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(rewritten.daemon.port).toBe(4243);
    expect(rewritten.agents).toBeDefined();
  });

  it('migrates legacy discovery.dirs into agents.additional', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({
        machine: { id: 'legacy', name: 'old' },
        discovery: { dirs: ['/opt/custom-agents', '/srv/team-agents'] },
      }) + '\n'
    );

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.agents.default).toBe(join(homedir(), 'agents'));
    expect(config.agents.additional).toEqual(['/opt/custom-agents', '/srv/team-agents']);
    expect(config.projects.default).toBe(join(homedir(), 'projects'));
    expect(config.projects.additional).toEqual([]);

    // Persisted in the new shape — `discovery.dirs` is gone.
    const rewritten = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(rewritten.discovery).toBeUndefined();
    expect(rewritten.agents.additional).toEqual(['/opt/custom-agents', '/srv/team-agents']);
  });

  it('valid config is loaded as-is without rewrite churn', async () => {
    const valid = {
      machine: { id: 'stable-id', name: 'host' },
      daemon: { port: 4243 },
      agents: { default: '/a', additional: [] },
      projects: { default: '/p', additional: [] },
      sync: { events: {} },
    };
    writeFileSync(join(testDir, 'config.json'), JSON.stringify(valid, null, 2) + '\n');
    writeFileSync(join(testDir, 'machine.json'), JSON.stringify(valid.machine, null, 2) + '\n');
    const before = readFileSync(join(testDir, 'config.json'), 'utf-8');

    const { loadConfig } = await import('./config.js');
    loadConfig();

    const after = readFileSync(join(testDir, 'config.json'), 'utf-8');
    expect(after).toBe(before);
  });
});
