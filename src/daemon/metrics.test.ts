import { describe, it, expect } from 'vitest';
import { collectMachineMetrics } from './metrics.js';

describe('collectMachineMetrics', () => {
  it('returns cpu/memory in expected ranges', async () => {
    const m = await collectMachineMetrics();

    expect(m.cpuUsage).toBeGreaterThanOrEqual(0);
    expect(m.cpuUsage).toBeLessThanOrEqual(100);

    expect(m.memoryTotalMb).toBeGreaterThan(0);
    expect(m.memoryUsedMb).toBeGreaterThanOrEqual(0);
    expect(m.memoryUsedMb).toBeLessThanOrEqual(m.memoryTotalMb);
  });

  it('includes disk metrics when statfs is available', async () => {
    const m = await collectMachineMetrics();

    if (m.diskTotalMb !== undefined) {
      expect(m.diskTotalMb).toBeGreaterThan(0);
      expect(m.diskUsedMb).toBeGreaterThanOrEqual(0);
      expect(m.diskUsedMb).toBeLessThanOrEqual(m.diskTotalMb);
    }
  });
});
