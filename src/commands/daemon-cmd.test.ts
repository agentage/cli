import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../daemon/daemon.js', () => ({
  getDaemonPid: vi.fn(),
  stopDaemon: vi.fn(),
  restartDaemon: vi.fn(),
}));

import { getDaemonPid, stopDaemon, restartDaemon } from '../daemon/daemon.js';
import { registerDaemon } from './daemon-cmd.js';

const mockGetDaemonPid = vi.mocked(getDaemonPid);
const mockStopDaemon = vi.mocked(stopDaemon);
const mockRestartDaemon = vi.mocked(restartDaemon);

describe('daemon command', () => {
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
    registerDaemon(program);
  });

  describe('daemon stop', () => {
    it('stops running daemon', async () => {
      mockGetDaemonPid.mockReturnValue(1234);

      await program.parseAsync(['node', 'agentage', 'daemon', 'stop']);

      expect(mockStopDaemon).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('stopped'))).toBe(true);
    });

    it('prints message when daemon is not running', async () => {
      mockGetDaemonPid.mockReturnValue(null);

      await program.parseAsync(['node', 'agentage', 'daemon', 'stop']);

      expect(mockStopDaemon).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes('not running'))).toBe(true);
    });
  });

  describe('daemon restart', () => {
    it('restarts daemon and shows new PID', async () => {
      mockRestartDaemon.mockResolvedValue(undefined);
      mockGetDaemonPid.mockReturnValue(5678);

      await program.parseAsync(['node', 'agentage', 'daemon', 'restart']);

      expect(mockRestartDaemon).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('5678'))).toBe(true);
    });
  });
});
