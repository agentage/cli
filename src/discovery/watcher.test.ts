import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../daemon/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { startWatcher } from './watcher.js';

describe('watcher', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'agentage-watcher-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a stop function', () => {
    const stop = startWatcher([tempDir], vi.fn());
    expect(typeof stop).toBe('function');
    stop();
  });

  it('calls onUpdate when agent file is created', async () => {
    const onUpdate = vi.fn();
    const stop = startWatcher([tempDir], onUpdate);

    // Create an agent file
    writeFileSync(join(tempDir, 'test.agent.md'), '# test');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 700));

    expect(onUpdate).toHaveBeenCalled();
    stop();
  });

  it('debounces multiple rapid changes', async () => {
    const onUpdate = vi.fn();
    const stop = startWatcher([tempDir], onUpdate);

    // Create multiple files rapidly
    writeFileSync(join(tempDir, 'a.agent.md'), '# a');
    writeFileSync(join(tempDir, 'b.agent.md'), '# b');
    writeFileSync(join(tempDir, 'c.agent.md'), '# c');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 700));

    // Should have been called only once due to debounce
    expect(onUpdate.mock.calls.length).toBeLessThanOrEqual(2);
    stop();
  });

  it('handles non-existent directory gracefully', () => {
    const stop = startWatcher(['/nonexistent/path'], vi.fn());
    expect(typeof stop).toBe('function');
    stop();
  });

  it('stops watching when stop is called', async () => {
    const onUpdate = vi.fn();
    const stop = startWatcher([tempDir], onUpdate);
    stop();

    // Create a file after stopping
    writeFileSync(join(tempDir, 'late.agent.md'), '# late');

    await new Promise((r) => setTimeout(r, 700));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('watches subdirectories for changes', async () => {
    const subDir = join(tempDir, 'sub');
    mkdirSync(subDir);

    const onUpdate = vi.fn();
    const stop = startWatcher([tempDir], onUpdate);

    writeFileSync(join(subDir, 'nested.agent.md'), '# nested');

    await new Promise((r) => setTimeout(r, 700));

    expect(onUpdate).toHaveBeenCalled();
    stop();
  });
});
