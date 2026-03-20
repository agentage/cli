import { describe, it, expect } from 'vitest';

describe('run command', () => {
  it('exports registerRun function', async () => {
    const mod = await import('./run.js');
    expect(typeof mod.registerRun).toBe('function');
  });
});
