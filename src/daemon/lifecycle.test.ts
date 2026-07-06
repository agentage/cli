import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
