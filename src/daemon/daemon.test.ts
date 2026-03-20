import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-daemon-${Date.now()}`);

describe('daemon', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('isDaemonRunning returns false when no PID file', async () => {
    const { isDaemonRunning } = await import('./daemon.js');
    expect(isDaemonRunning()).toBe(false);
  });

  it('isDaemonRunning returns true for live process PID', async () => {
    writeFileSync(join(testDir, 'daemon.pid'), String(process.pid));
    const { isDaemonRunning } = await import('./daemon.js');
    expect(isDaemonRunning()).toBe(true);
  });

  it('isDaemonRunning cleans up stale PID file', async () => {
    writeFileSync(join(testDir, 'daemon.pid'), '999999');
    const { isDaemonRunning } = await import('./daemon.js');
    // Process 999999 is almost certainly not alive
    expect(isDaemonRunning()).toBe(false);
  });

  it('getDaemonPid returns null when not running', async () => {
    const { getDaemonPid } = await import('./daemon.js');
    expect(getDaemonPid()).toBeNull();
  });

  it('getDaemonPid returns PID for live process', async () => {
    writeFileSync(join(testDir, 'daemon.pid'), String(process.pid));
    const { getDaemonPid } = await import('./daemon.js');
    expect(getDaemonPid()).toBe(process.pid);
  });

  it('writePidFile and removePidFile work', async () => {
    const { existsSync } = await import('node:fs');
    const { writePidFile, removePidFile } = await import('./daemon.js');

    writePidFile(12345);
    expect(existsSync(join(testDir, 'daemon.pid'))).toBe(true);

    removePidFile();
    expect(existsSync(join(testDir, 'daemon.pid'))).toBe(false);
  });

  it('stopDaemon handles no PID file gracefully', async () => {
    const { stopDaemon } = await import('./daemon.js');
    // Should not throw
    stopDaemon();
  });

  it('isDaemonRunning handles invalid PID file content', async () => {
    writeFileSync(join(testDir, 'daemon.pid'), 'not-a-number');
    const { isDaemonRunning } = await import('./daemon.js');
    expect(isDaemonRunning()).toBe(false);
  });

  it('getDaemonPid handles invalid PID file content', async () => {
    writeFileSync(join(testDir, 'daemon.pid'), 'abc');
    const { getDaemonPid } = await import('./daemon.js');
    expect(getDaemonPid()).toBeNull();
  });

  it('removePidFile is safe when no PID file exists', async () => {
    const { removePidFile } = await import('./daemon.js');
    // Should not throw
    removePidFile();
  });
});
