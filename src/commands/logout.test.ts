import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../hub/auth.js', () => ({
  readAuth: vi.fn(),
  deleteAuth: vi.fn(),
}));

vi.mock('../hub/hub-client.js', () => ({
  createHubClient: vi.fn(),
}));

import { readAuth, deleteAuth } from '../hub/auth.js';
import { createHubClient } from '../hub/hub-client.js';
import { registerLogout } from './logout.js';

const mockReadAuth = vi.mocked(readAuth);
const mockDeleteAuth = vi.mocked(deleteAuth);
const mockCreateHubClient = vi.mocked(createHubClient);

describe('logout command', () => {
  let program: Command;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerLogout(program);
  });

  it('prints not logged in when no auth', async () => {
    mockReadAuth.mockReturnValue(null);

    await program.parseAsync(['node', 'agentage', 'logout']);

    expect(logs.some((l) => l.includes('Not logged in'))).toBe(true);
    expect(mockDeleteAuth).not.toHaveBeenCalled();
  });

  it('deregisters and deletes auth on logout', async () => {
    const mockDeregister = vi.fn().mockResolvedValue(undefined);
    mockReadAuth.mockReturnValue({
      session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
      user: { id: 'u1', email: 'v@test.com' },
      hub: { url: 'https://hub.test', machineId: 'machine-1' },
    });
    mockCreateHubClient.mockReturnValue({ deregister: mockDeregister } as ReturnType<typeof createHubClient>);

    await program.parseAsync(['node', 'agentage', 'logout']);

    expect(mockDeregister).toHaveBeenCalledWith('machine-1');
    expect(mockDeleteAuth).toHaveBeenCalled();
    expect(logs.some((l) => l.includes('Disconnected from hub'))).toBe(true);
    expect(logs.some((l) => l.includes('standalone mode'))).toBe(true);
  });

  it('still deletes auth when deregister fails', async () => {
    mockReadAuth.mockReturnValue({
      session: { access_token: 'tk', refresh_token: '', expires_at: 0 },
      user: { id: 'u1', email: '' },
      hub: { url: 'https://hub.test', machineId: 'machine-1' },
    });
    mockCreateHubClient.mockReturnValue({
      deregister: vi.fn().mockRejectedValue(new Error('Network error')),
    } as ReturnType<typeof createHubClient>);

    await program.parseAsync(['node', 'agentage', 'logout']);

    expect(mockDeleteAuth).toHaveBeenCalled();
    expect(logs.some((l) => l.includes('Disconnected from hub'))).toBe(true);
  });
});
