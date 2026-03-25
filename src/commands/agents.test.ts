import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

import { get, post } from '../utils/daemon-client.js';
import { registerAgents } from './agents.js';

const mockGet = vi.mocked(get);
const mockPost = vi.mocked(post);

describe('agents command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerAgents(program);
  });

  it('lists local agents from daemon', async () => {
    mockGet.mockResolvedValue([
      { name: 'hello', description: 'A greeting agent', path: '/agents/hello.agent.md' },
    ]);

    await program.parseAsync(['node', 'agentage', 'agents']);

    expect(mockGet).toHaveBeenCalledWith('/api/agents');
    expect(logs.some((l) => l.includes('hello'))).toBe(true);
    expect(logs.some((l) => l.includes('A greeting agent'))).toBe(true);
  });

  it('refreshes agents with --refresh', async () => {
    mockPost.mockResolvedValue([
      { name: 'refreshed', description: 'Refreshed', path: '/agents/refreshed.agent.md' },
    ]);

    await program.parseAsync(['node', 'agentage', 'agents', '--refresh']);

    expect(mockPost).toHaveBeenCalledWith('/api/agents/refresh');
  });

  it('outputs JSON with --json', async () => {
    const agents = [{ name: 'test', description: 'Test', path: '/test' }];
    mockGet.mockResolvedValue(agents);

    await program.parseAsync(['node', 'agentage', 'agents', '--json']);

    expect(logs[0]).toBe(JSON.stringify(agents, null, 2));
  });

  it('prints message when no agents found', async () => {
    mockGet.mockResolvedValue([]);

    await program.parseAsync(['node', 'agentage', 'agents']);

    expect(logs.some((l) => l.includes('No agents discovered'))).toBe(true);
  });

  describe('--all (hub mode)', () => {
    it('fetches agents from hub', async () => {
      mockGet.mockResolvedValue([
        { name: 'remote-agent', description: 'Hub agent', machines: { name: 'my-pc', status: 'online' } },
      ]);

      await program.parseAsync(['node', 'agentage', 'agents', '--all']);

      expect(mockGet).toHaveBeenCalledWith('/api/hub/agents');
      expect(logs.some((l) => l.includes('remote-agent'))).toBe(true);
    });

    it('shows error when not connected to hub', async () => {
      mockGet.mockRejectedValue(new Error('Unauthorized'));

      await program.parseAsync(['node', 'agentage', 'agents', '--all']);

      expect(errorLogs.some((l) => l.includes('Not connected to hub'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('outputs JSON in hub mode', async () => {
      const agents = [{ name: 'hub-agent', description: 'Hub', machines: { name: 'pc', status: 'online' } }];
      mockGet.mockResolvedValue(agents);

      await program.parseAsync(['node', 'agentage', 'agents', '--all', '--json']);

      expect(logs[0]).toBe(JSON.stringify(agents, null, 2));
    });

    it('prints message when no hub agents found', async () => {
      mockGet.mockResolvedValue([]);

      await program.parseAsync(['node', 'agentage', 'agents', '--all']);

      expect(logs.some((l) => l.includes('No agents found across machines'))).toBe(true);
    });

    it('shows offline status for offline machines', async () => {
      mockGet.mockResolvedValue([
        { name: 'offline-agent', description: 'Agent', machines: { name: 'old-pc', status: 'offline' } },
      ]);

      await program.parseAsync(['node', 'agentage', 'agents', '--all']);

      expect(logs.some((l) => l.includes('offline'))).toBe(true);
    });
  });

  it('shows table header with correct columns', async () => {
    mockGet.mockResolvedValue([
      { name: 'a', description: 'desc', path: '/p' },
    ]);

    await program.parseAsync(['node', 'agentage', 'agents']);

    expect(logs[0]).toContain('NAME');
    expect(logs[0]).toContain('DESCRIPTION');
    expect(logs[0]).toContain('PATH');
  });

  it('handles agents without descriptions', async () => {
    mockGet.mockResolvedValue([
      { name: 'nodesc', path: '/test' },
    ]);

    await program.parseAsync(['node', 'agentage', 'agents']);

    expect(logs.some((l) => l.includes('nodesc'))).toBe(true);
  });
});
