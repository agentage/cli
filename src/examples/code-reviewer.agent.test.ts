import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('code-reviewer agent', () => {
  it('has correct manifest with declarative config', async () => {
    const { default: agent } = await import('./code-reviewer.agent.js');
    expect(agent.manifest.name).toBe('code-reviewer');
    expect(agent.manifest.description).toBe('Reviews code for quality issues');
    expect(agent.manifest.config).toEqual({
      model: 'claude-sonnet-4-6',
      tools: ['read', 'glob', 'grep'],
      prompt: expect.stringContaining('senior code reviewer'),
    });
  });

  it('has run function (auto-provided)', async () => {
    const { default: agent } = await import('./code-reviewer.agent.js');
    expect(typeof agent.run).toBe('function');
  });

  it('declarative agent yields auto-result', async () => {
    const { default: agent } = await import('./code-reviewer.agent.js');
    const process = await agent.run({ task: 'review this' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('result');
    expect((events[0]!.data as Record<string, unknown>).success).toBe(true);
  });
});
