import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-create-${Date.now()}`);
const configDir = join(testDir, '.agentage');

describe('create command', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = configDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates agent file with simple template', async () => {
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'my-agent', '--dir', testDir]);

    const filePath = join(testDir, 'my-agent.agent.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain("name: 'my-agent'");
    expect(content).toContain('import { agent');
  });

  it('creates agent with shell template', async () => {
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'my-shell', '--template', 'shell', '--dir', testDir]);

    const content = readFileSync(join(testDir, 'my-shell.agent.ts'), 'utf-8');
    expect(content).toContain("name: 'my-shell'");
    expect(content).toContain('yield* shell(');
  });

  it('creates agent with llm template', async () => {
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'my-llm', '--template', 'llm', '--dir', testDir]);

    const content = readFileSync(join(testDir, 'my-llm.agent.ts'), 'utf-8');
    expect(content).toContain("name: 'my-llm'");
    expect(content).toContain("model: 'claude-sonnet-4-6'");
    expect(content).not.toContain('async *run');
  });

  it('rejects invalid name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'NotKebab', '--dir', testDir]);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects unknown template', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'my-agent', '--template', 'unknown', '--dir', testDir]);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects if file already exists', async () => {
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();

    // Create first
    await cmd.parseAsync(['node', 'test', 'existing', '--dir', testDir]);
    expect(existsSync(join(testDir, 'existing.agent.ts'))).toBe(true);

    // Try again
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cmd2 = createCreateCommand();
    await cmd2.parseAsync(['node', 'test', 'existing', '--dir', testDir]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ─── QW-1: defaults to discovery dir ───────────────────────

  it('defaults to first discovery dir when no --dir given', async () => {
    // Set up config with discovery dirs
    const agentsDir = join(configDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = configDir;
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        machine: { id: 'test', name: 'test' },
        daemon: { port: 4243 },
        agents: { default: agentsDir, additional: [] },
        projects: { default: '/tmp/projects', additional: [] },
        sync: { events: {} },
      })
    );

    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'default-dir-agent']);

    expect(existsSync(join(agentsDir, 'default-dir-agent.agent.ts'))).toBe(true);
    delete process.env['AGENTAGE_CONFIG_DIR'];
  });

  // ─── QW-2: smart post-create message ───────────────────────

  it('shows auto-discovered message when created in discovery dir', async () => {
    const agentsDir = join(configDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = configDir;
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        machine: { id: 'test', name: 'test' },
        daemon: { port: 4243 },
        agents: { default: agentsDir, additional: [] },
        projects: { default: '/tmp/projects', additional: [] },
        sync: { events: {} },
      })
    );

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'auto-agent', '--dir', agentsDir]);

    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('auto-discovered');
    expect(output).toContain('agentage run auto-agent');
    expect(output).not.toContain('cp ');

    spy.mockRestore();
    delete process.env['AGENTAGE_CONFIG_DIR'];
  });

  it('shows cp instructions when created outside discovery dir', async () => {
    const agentsDir = join(configDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = configDir;
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        machine: { id: 'test', name: 'test' },
        daemon: { port: 4243 },
        agents: { default: agentsDir, additional: [] },
        projects: { default: '/tmp/projects', additional: [] },
        sync: { events: {} },
      })
    );

    const otherDir = join(testDir, 'other');
    mkdirSync(otherDir, { recursive: true });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'other-agent', '--dir', otherDir]);

    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('cp ');
    expect(output).not.toContain('auto-discovered');

    spy.mockRestore();
    delete process.env['AGENTAGE_CONFIG_DIR'];
  });
});
