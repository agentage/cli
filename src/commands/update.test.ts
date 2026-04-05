import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/agentage-test'),
}));

vi.mock('../daemon/daemon.js', () => ({
  isDaemonRunning: vi.fn(),
  restartDaemon: vi.fn(),
  getDaemonPid: vi.fn(),
}));

vi.mock('../utils/update-checker.js', () => ({
  checkForUpdate: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { isDaemonRunning, restartDaemon, getDaemonPid } from '../daemon/daemon.js';
import { checkForUpdate } from '../utils/update-checker.js';
import { registerUpdate } from './update.js';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockIsDaemonRunning = vi.mocked(isDaemonRunning);
const mockRestartDaemon = vi.mocked(restartDaemon);
const mockGetDaemonPid = vi.mocked(getDaemonPid);
const mockCheckForUpdate = vi.mocked(checkForUpdate);

describe('update command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];

  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    vi.resetAllMocks();
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    // Default: lock file does not exist
    mockExistsSync.mockReturnValue(false);
    // Default: daemon not running
    mockIsDaemonRunning.mockReturnValue(false);

    program = new Command();
    program.exitOverride();
    registerUpdate(program);
  });

  describe('command registration', () => {
    it('registers an "update" command', () => {
      const cmd = program.commands.find((c) => c.name() === 'update');
      expect(cmd).toBeDefined();
    });

    it('has the expected description', () => {
      const cmd = program.commands.find((c) => c.name() === 'update');
      expect(cmd?.description()).toBe('Update @agentage/cli to the latest version');
    });

    it('has a --check option', () => {
      const cmd = program.commands.find((c) => c.name() === 'update');
      const checkOpt = cmd?.options.find((o) => o.long === '--check');
      expect(checkOpt).toBeDefined();
    });
  });

  describe('action handler', () => {
    it('logs "Already on the latest version" and exits 0 when no update available', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: false,
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
      });

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(logs.some((l) => l.includes('Already on the latest version'))).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('does not run execSync when --check flag is used with update available', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });

      await program.parseAsync(['node', 'agentage', 'update', '--check']).catch(() => {});

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes('agentage update'))).toBe(true);
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('warns and exits 1 when lock file already exists (lock contention)', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      // Lock file exists → acquireLock returns false
      mockExistsSync.mockReturnValue(true);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(logs.some((l) => l.includes('Another update is already in progress'))).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('calls execSync with npm update -g @agentage/cli when update is available', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(false);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(mockExecSync).toHaveBeenCalledWith(
        'npm update -g @agentage/cli',
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('logs success and exits 0 after a successful update', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(false);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(logs.some((l) => l.includes('Updated to 2.0.0'))).toBe(true);
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('releases the lock after a successful update', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      // First call: acquireLock existsSync → false (no lock). Second call (releaseLock existsSync) → true (lock exists).
      mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('logs error and exits 1 when execSync throws', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => {
        throw new Error('npm failed');
      });

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(errorLogs.some((l) => l.includes('Update failed'))).toBe(true);
      expect(errorLogs.some((l) => l.includes('npm failed'))).toBe(true);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('restarts daemon and logs new PID when daemon is running after update', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(false);
      mockIsDaemonRunning.mockReturnValue(true);
      mockRestartDaemon.mockResolvedValue(undefined);
      mockGetDaemonPid.mockReturnValue(9999);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(mockRestartDaemon).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('9999'))).toBe(true);
    });

    it('does not restart daemon when daemon is not running', async () => {
      mockCheckForUpdate.mockResolvedValue({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(false);
      mockIsDaemonRunning.mockReturnValue(false);

      await program.parseAsync(['node', 'agentage', 'update']).catch(() => {});

      expect(mockRestartDaemon).not.toHaveBeenCalled();
    });
  });
});
