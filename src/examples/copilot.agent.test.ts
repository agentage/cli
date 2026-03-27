import { describe, it, expect } from 'vitest';

describe('copilot — structural', () => {
  it('has correct manifest', async () => {
    const { agent } = await import('./copilot.agent.js');
    expect(agent.manifest.name).toBe('copilot');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });

  it('has expected tags', async () => {
    const { agent } = await import('./copilot.agent.js');
    expect(agent.manifest.tags).toContain('copilot');
    expect(agent.manifest.tags).toContain('github');
  });
});

describe.skipIf(!process.env['GITHUB_TOKEN'])('copilot — live', () => {
  it('streams response for simple prompt', async () => {
    const { agent } = await import('./copilot.agent.js');
    const process = await agent.run({ task: 'What is 2+2?' });
    const events: (typeof import('@agentage/core').RunEvent)[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  }, 30_000);
});
