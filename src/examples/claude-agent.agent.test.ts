import { describe, it, expect } from 'vitest';

describe('claude-agent agent', () => {
  it('has correct manifest', async () => {
    const { default: agent } = await import('./claude-agent.agent.js');
    expect(agent.manifest.name).toBe('claude-agent');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });
});
