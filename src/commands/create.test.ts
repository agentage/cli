import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-create-${Date.now()}`);

describe('create command', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
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
    expect(content).toContain('createAgent');
  });

  it('creates agent with shell template', async () => {
    const { createCreateCommand } = await import('./create.js');
    const cmd = createCreateCommand();
    await cmd.parseAsync(['node', 'test', 'my-shell', '--template', 'shell', '--dir', testDir]);

    const content = readFileSync(join(testDir, 'my-shell.agent.ts'), 'utf-8');
    expect(content).toContain("name: 'my-shell'");
    expect(content).toContain('spawn');
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
});
