import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../hub/auth.js', () => ({
  readAuth: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
}));

import { readAuth } from '../hub/auth.js';
import { loadConfig } from '../daemon/config.js';
import { registerWhoami } from './whoami.js';

const mockReadAuth = vi.mocked(readAuth);
const mockLoadConfig = vi.mocked(loadConfig);

describe('whoami command', () => {
  let program: Command;
  let logs: string[];

  const defaultConfig = {
    machine: { id: 'machine-123', name: 'test-host' },
    daemon: { port: 4243 },
    agents: { default: '/tmp/agents', additional: [] },
    projects: { default: '/tmp/projects', additional: [] },
    hub: { url: 'https://agentage.io' },
    sync: {
      events: {
        state: true,
        result: true,
        error: true,
        input_required: true,
        'output.llm.delta': true,
        'output.llm.tool_call': true,
        'output.llm.usage': true,
        'output.progress': true,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    mockLoadConfig.mockReturnValue(structuredClone(defaultConfig));

    program = new Command();
    program.exitOverride();
    registerWhoami(program);
  });

  it('shows user info when logged in', async () => {
    mockReadAuth.mockReturnValue({
      session: { access_token: 'at', refresh_token: 'rt', expires_at: 9999 },
      user: { id: 'u1', email: 'v@test.com' },
      hub: { url: 'https://agentage.io', machineId: 'machine-123' },
    });

    await program.parseAsync(['node', 'agentage', 'whoami']);

    expect(logs.some((l) => l.includes('v@test.com'))).toBe(true);
    expect(logs.some((l) => l.includes('test-host'))).toBe(true);
    expect(logs.some((l) => l.includes('machine-123'))).toBe(true);
  });

  it('shows not logged in when no auth', async () => {
    mockReadAuth.mockReturnValue(null);

    await program.parseAsync(['node', 'agentage', 'whoami']);

    expect(logs.some((l) => l.includes('Not logged in'))).toBe(true);
    expect(logs.some((l) => l.includes('test-host'))).toBe(true);
  });

  it('outputs JSON with --json when logged in', async () => {
    mockReadAuth.mockReturnValue({
      session: { access_token: 'at', refresh_token: 'rt', expires_at: 9999 },
      user: { id: 'u1', email: 'v@test.com' },
      hub: { url: 'https://agentage.io', machineId: 'machine-123' },
    });

    await program.parseAsync(['node', 'agentage', 'whoami', '--json']);

    const parsed = JSON.parse(logs[0]!);
    expect(parsed.loggedIn).toBe(true);
    expect(parsed.email).toBe('v@test.com');
    expect(parsed.machineName).toBe('test-host');
    expect(parsed.machineId).toBe('machine-123');
  });

  it('outputs JSON with --json when not logged in', async () => {
    mockReadAuth.mockReturnValue(null);

    await program.parseAsync(['node', 'agentage', 'whoami', '--json']);

    const parsed = JSON.parse(logs[0]!);
    expect(parsed.loggedIn).toBe(false);
    expect(parsed.email).toBeNull();
  });
});
