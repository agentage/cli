import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-logger-${Date.now()}`);

describe('logger', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes to daemon.log', async () => {
    const { logInfo } = await import('./logger.js');
    logInfo('test message');

    const logPath = join(testDir, 'daemon.log');
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('test message');
    expect(content).toContain('[INFO]');
  });

  it('respects log levels — debug not written at info level', async () => {
    const { logDebug, setLogLevel } = await import('./logger.js');
    setLogLevel('info');
    logDebug('debug message');

    const logPath = join(testDir, 'daemon.log');
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, 'utf-8');
      expect(content).not.toContain('debug message');
    }
  });

  it('writes error level messages', async () => {
    const { logError } = await import('./logger.js');
    logError('something broke');

    const logPath = join(testDir, 'daemon.log');
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('something broke');
  });

  it('writes warn level messages', async () => {
    const { logWarn } = await import('./logger.js');
    logWarn('be careful');

    const logPath = join(testDir, 'daemon.log');
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('[WARN]');
    expect(content).toContain('be careful');
  });

  it('includes timestamp in log entries', async () => {
    const { logInfo } = await import('./logger.js');
    logInfo('timestamp test');

    const logPath = join(testDir, 'daemon.log');
    const content = readFileSync(logPath, 'utf-8');
    // ISO timestamp pattern
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
