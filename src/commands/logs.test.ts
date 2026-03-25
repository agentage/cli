import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

vi.mock('../daemon/config.js', () => ({
  getConfigDir: vi.fn(),
}));

import { getConfigDir } from '../daemon/config.js';
import { registerLogs } from './logs.js';

const mockGetConfigDir = vi.mocked(getConfigDir);

describe('logs command', () => {
  let tempDir: string;
  let program: Command;
  let logs: string[];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentage-logs-test-'));
    mockGetConfigDir.mockReturnValue(tempDir);

    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerLogs(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints message when no log file exists', async () => {
    await program.parseAsync(['node', 'agentage', 'logs']);
    expect(logs.some((l) => l.includes('No daemon log found'))).toBe(true);
  });

  it('tails last 50 lines by default', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    writeFileSync(join(tempDir, 'daemon.log'), lines.join('\n'));

    await program.parseAsync(['node', 'agentage', 'logs']);

    expect(logs).toHaveLength(50);
    expect(logs[0]).toBe('line-51');
    expect(logs[49]).toBe('line-100');
  });

  it('respects -n flag for line count', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
    writeFileSync(join(tempDir, 'daemon.log'), lines.join('\n'));

    await program.parseAsync(['node', 'agentage', 'logs', '-n', '5']);

    expect(logs).toHaveLength(5);
    expect(logs[0]).toBe('line-16');
  });

  it('handles log file with fewer lines than requested', async () => {
    writeFileSync(join(tempDir, 'daemon.log'), 'only-one-line');

    await program.parseAsync(['node', 'agentage', 'logs']);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe('only-one-line');
  });

  it('follow mode sets up file watcher and SIGINT handler', async () => {
    writeFileSync(join(tempDir, 'daemon.log'), 'initial-line\n');

    const onSpy = vi.spyOn(process, 'on');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const parsePromise = program.parseAsync(['node', 'agentage', 'logs', '-f']);

    // Wait for the action to set up the watcher
    await new Promise((r) => setTimeout(r, 50));

    // Verify SIGINT handler was registered (follow mode is active)
    expect(onSpy.mock.calls.some(([event]) => event === 'SIGINT')).toBe(true);

    // Simulate SIGINT to clean up the watcher
    process.emit('SIGINT', 'SIGINT');
    expect(exitSpy).toHaveBeenCalledWith(0);

    await parsePromise.catch(() => {});
    onSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
