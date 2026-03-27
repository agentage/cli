import { describe, it, expect } from 'vitest';

describe('copilot agent', () => {
  it('has correct manifest', async () => {
    const { default: agent } = await import('./copilot.agent.js');
    expect(agent.manifest.name).toBe('copilot');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });
});
