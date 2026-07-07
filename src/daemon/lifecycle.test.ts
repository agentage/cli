import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import {
  DEFAULT_DAEMON_PORT,
  isDaemonRunning,
  isProcessAlive,
  removePidFile,
  removePortFile,
  resolvePort,
  stopDaemon,
  stopDaemonAndWait,
  stopDaemonSafely,
  writePidFile,
  writePortFile,
} from './lifecycle.js';

// A pid that is essentially never alive (max 32-bit).
const DEAD_PID = 2147483646;

let dir: string;
const savedConfigDir = process.env['AGENTAGE_CONFIG_DIR'];
const savedPort = process.env['AGENTAGE_DAEMON_PORT'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-daemon-lc-'));
  process.env['AGENTAGE_CONFIG_DIR'] = dir;
  delete process.env['AGENTAGE_DAEMON_PORT'];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedConfigDir === undefined) delete process.env['AGENTAGE_CONFIG_DIR'];
  else process.env['AGENTAGE_CONFIG_DIR'] = savedConfigDir;
  if (savedPort === undefined) delete process.env['AGENTAGE_DAEMON_PORT'];
  else process.env['AGENTAGE_DAEMON_PORT'] = savedPort;
});

describe('pidfile lifecycle', () => {
  it('reports not-running with no pidfile', () => {
    expect(isDaemonRunning()).toBe(false);
  });

  it('treats our own pid as a live daemon', () => {
    writePidFile(process.pid);
    expect(isDaemonRunning()).toBe(true);
  });

  it('prunes a stale pidfile (dead pid) and reports not-running', () => {
    writePidFile(DEAD_PID);
    writePortFile(5000);
    expect(isDaemonRunning()).toBe(false);
  });

  it('ignores a garbage pidfile', () => {
    writeFileSync(join(dir, 'daemon.pid'), 'not-a-number', 'utf-8');
    expect(isDaemonRunning()).toBe(false);
  });

  it('isProcessAlive matches process.kill(pid,0)', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});

describe('resolvePort', () => {
  it('falls back to the default port', () => {
    expect(resolvePort()).toBe(DEFAULT_DAEMON_PORT);
  });

  it('reads the recorded port file', () => {
    writePortFile(45123);
    expect(resolvePort()).toBe(45123);
  });

  it('lets the env override win over the port file', () => {
    writePortFile(45123);
    process.env['AGENTAGE_DAEMON_PORT'] = '46000';
    expect(resolvePort()).toBe(46000);
  });
});

describe('stopDaemon', () => {
  it('returns false and clears files when the recorded pid is dead', () => {
    writePidFile(DEAD_PID);
    writePortFile(5000);
    expect(stopDaemon()).toBe(false);
    expect(isDaemonRunning()).toBe(false);
  });

  it('returns false when nothing is recorded', () => {
    expect(stopDaemon()).toBe(false);
  });

  it('removePidFile/removePortFile are safe when absent', () => {
    writePidFile(DEAD_PID);
    writePortFile(1);
    expect(readFileSync(join(dir, 'daemon.pid'), 'utf-8')).toBe(String(DEAD_PID));
    removePidFile();
    removePortFile();
    removePidFile();
    expect(isDaemonRunning()).toBe(false);
  });
});

describe('stopDaemonSafely', () => {
  afterEach(() => vi.restoreAllMocks());

  const spawnLive = (): number => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    return child.pid!;
  };

  it('signals a live pid the /health probe confirms', async () => {
    const pid = spawnLive();
    writePidFile(pid);
    writePortFile(5000);
    expect(await stopDaemonSafely(async () => pid)).toBe(true);
    expect(isDaemonRunning()).toBe(false);
  });

  it('refuses to signal when the recorded port reports a different pid (recycled)', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pid = spawnLive();
    writePidFile(pid);
    writePortFile(5000);
    try {
      expect(await stopDaemonSafely(async () => pid + 1)).toBe(false);
      expect(isProcessAlive(pid)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      process.kill(pid, 'SIGKILL');
    }
  });

  it('falls back to a blind signal with a caveat when no port was recorded', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pid = spawnLive();
    writePidFile(pid);
    expect(await stopDaemonSafely(async () => null)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('defers to stopDaemon (returns false) when nothing live is recorded', async () => {
    expect(await stopDaemonSafely(async () => 1)).toBe(false);
    writePidFile(DEAD_PID);
    writePortFile(5000);
    expect(await stopDaemonSafely(async () => 1)).toBe(false);
  });
});

describe('stopDaemonAndWait', () => {
  it('returns true immediately when nothing is running', async () => {
    expect(await stopDaemonAndWait()).toBe(true);
    writePidFile(DEAD_PID);
    expect(await stopDaemonAndWait()).toBe(true);
  });

  it('signals a real process and waits for it to be gone', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    writePidFile(child.pid!);
    expect(await stopDaemonAndWait(5000)).toBe(true);
    expect(isProcessAlive(child.pid!)).toBe(false);
  });
});
