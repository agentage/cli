import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../hub/auth.js', () => ({
  saveAuth: vi.fn(),
  readAuth: vi.fn(),
  deleteAuth: vi.fn(),
}));

vi.mock('../hub/auth-callback.js', () => ({
  startCallbackServer: vi.fn(),
  getCallbackPort: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

import { saveAuth } from '../hub/auth.js';
import { startCallbackServer, getCallbackPort } from '../hub/auth-callback.js';
import { loadConfig, saveConfig } from '../daemon/config.js';
import { registerLogin } from './login.js';

const mockSaveAuth = vi.mocked(saveAuth);
const mockStartCallback = vi.mocked(startCallbackServer);
const mockGetCallbackPort = vi.mocked(getCallbackPort);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);

describe('login command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];
  let tempDir: string;
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'agentage-login-test-'));
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    mockLoadConfig.mockReturnValue({
      machine: { id: 'machine-1', name: 'test-pc' },
      daemon: { port: 4243 },
      discovery: { dirs: [] },
      sync: { events: {} },
    } as unknown as ReturnType<typeof loadConfig>);

    program = new Command();
    program.exitOverride();
    registerLogin(program);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('token mode', () => {
    it('saves auth with direct token', async () => {
      await program.parseAsync(['node', 'agentage', 'login', '--token', 'my-token']);

      expect(mockSaveAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ access_token: 'my-token' }),
          hub: expect.objectContaining({ url: 'https://agentage.io', machineId: 'machine-1' }),
        })
      );
      expect(mockSaveConfig).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('Logged in with token'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('uses custom hub URL with --hub', async () => {
      await program.parseAsync([
        'node',
        'agentage',
        'login',
        '--hub',
        'https://custom.hub',
        '--token',
        'tk',
      ]);

      expect(mockSaveAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          hub: expect.objectContaining({ url: 'https://custom.hub' }),
        })
      );
    });
  });

  describe('browser mode', () => {
    it('starts callback server and opens browser', async () => {
      mockStartCallback.mockResolvedValue({
        session: { access_token: 'at', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: 'v@test.com' },
        hub: { url: '', machineId: '' },
      });
      mockGetCallbackPort.mockReturnValue(54321);

      await program.parseAsync(['node', 'agentage', 'login']);

      expect(mockStartCallback).toHaveBeenCalled();
      expect(mockSaveAuth).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('v@test.com'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('fails when callback server does not start', async () => {
      mockStartCallback.mockImplementation(() => new Promise(() => {})); // never resolves
      mockGetCallbackPort.mockReturnValue(0);

      await program.parseAsync(['node', 'agentage', 'login']);

      expect(errorLogs.some((l) => l.includes('Failed to start callback server'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('handles login failure', async () => {
      mockStartCallback.mockRejectedValue(new Error('Timed out'));
      mockGetCallbackPort.mockReturnValue(9999);

      await program.parseAsync(['node', 'agentage', 'login']);

      expect(errorLogs.some((l) => l.includes('Login failed') && l.includes('Timed out'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });
  });
});
