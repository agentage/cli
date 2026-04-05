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

  it('declarative agent auto-runs via claude adapter', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { default: agent } = await import('./code-reviewer.agent.js');
      const run = await agent.run({ task: 'review this' });
      const events: RunEvent[] = [];
      for await (const event of run.events) {
        events.push(event);
      }

      // core 0.5.x: declarative agents auto-run via claude() adapter,
      // which emits an error event followed by a result when no API key is set.
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('error');
      expect((events[0]!.data as Record<string, unknown>).code).toBe('MISSING_API_KEY');
      expect(events[1]!.type).toBe('result');
      expect((events[1]!.data as Record<string, unknown>).success).toBe(false);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
