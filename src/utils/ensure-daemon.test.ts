import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `agentage-test-ensure-${Date.now()}`);

describe('ensure-daemon', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns immediately if daemon is running', async () => {
    // Write a PID file with current process PID (which is alive)
    writeFileSync(join(testDir, 'daemon.pid'), String(process.pid));

    const { ensureDaemon } = await import('./ensure-daemon.js');
    // Should not throw — daemon PID file points to a live process
    await ensureDaemon();
  });
});
