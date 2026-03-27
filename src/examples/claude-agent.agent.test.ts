import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('claude-agent — structural', () => {
  it('has correct manifest', async () => {
    const { agent } = await import('./claude-agent.agent.js');
    expect(agent.manifest.name).toBe('claude-agent');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });

  it('has expected tags', async () => {
    const { agent } = await import('./claude-agent.agent.js');
    expect(agent.manifest.tags).toContain('llm');
    expect(agent.manifest.tags).toContain('claude');
  });

  describe('when ANTHROPIC_API_KEY is missing', () => {
    let originalKey: string | undefined;

    beforeEach(() => {
      originalKey = process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
    });

    afterEach(() => {
      if (originalKey !== undefined) {
        process.env['ANTHROPIC_API_KEY'] = originalKey;
      }
    });

    it('yields error and failed result', async () => {
      const { agent } = await import('./claude-agent.agent.js');
      const process = await agent.run({ task: 'test' });
      const events: RunEvent[] = [];
      for await (const event of process.events) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as Record<string, unknown>).code).toBe('MISSING_API_KEY');

      const result = events.find((e) => e.type === 'result');
      expect(result).toBeDefined();
      expect((result!.data as Record<string, unknown>).success).toBe(false);
    });
  });
});

describe.skipIf(!process.env['ANTHROPIC_API_KEY'])('claude-agent — live', () => {
  it('streams response for simple prompt', async () => {
    const { agent } = await import('./claude-agent.agent.js');
    const process = await agent.run({ task: 'What is 2+2? Answer in one word.' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    expect((result!.data as Record<string, unknown>).success).toBe(true);
  }, 30_000);
});
