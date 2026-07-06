import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMcp } from './mcp.js';

const { loadLocalMemoryServer, connect } = vi.hoisted(() => {
  const connect = vi.fn(async () => {});
  return { loadLocalMemoryServer: vi.fn(async () => ({ connect })), connect };
});
vi.mock('../mcp/local-server.js', () => ({ loadLocalMemoryServer }));

const run = async (args: string[]): Promise<void> => {
  const program = new Command();
  program.exitOverride();
  registerMcp(program);
  await program.parseAsync(['node', 'agentage', ...args]);
};

afterEach(() => {
  connect.mockClear();
  loadLocalMemoryServer.mockClear();
});

describe('agentage mcp', () => {
  it('registers the mcp command', () => {
    const program = new Command();
    registerMcp(program);
    expect(program.commands.map((c) => c.name())).toContain('mcp');
  });

  it('loads the local memory server and connects a stdio transport', async () => {
    await run(['mcp']);
    expect(loadLocalMemoryServer).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
