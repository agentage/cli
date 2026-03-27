import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('countdown agent', () => {
  it('has correct manifest', async () => {
    const { agent } = await import('./countdown.agent.js');
    expect(agent.manifest.name).toBe('countdown');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });

  it('yields output events for each number', async () => {
    const { agent } = await import('./countdown.agent.js');

    // Use a small start value for fast test
    const process = await agent.run({ task: 'go', config: { start: 2 } });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const textOutputs = events.filter(
      (e) => e.type === 'output' && (e.data as Record<string, unknown>).format === 'text'
    );
    expect(textOutputs).toHaveLength(3); // 2, 1, 0
    expect((textOutputs[0]!.data as Record<string, unknown>).content).toBe('2');
    expect((textOutputs[1]!.data as Record<string, unknown>).content).toBe('1');
    expect((textOutputs[2]!.data as Record<string, unknown>).content).toBe('0');
  }, 10_000);

  it('yields progress events', async () => {
    const { agent } = await import('./countdown.agent.js');
    const process = await agent.run({ task: 'go', config: { start: 2 } });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const progressEvents = events.filter(
      (e) => e.type === 'output' && (e.data as Record<string, unknown>).format === 'progress'
    );
    expect(progressEvents.length).toBeGreaterThan(0);
  }, 10_000);

  it('yields result event last', async () => {
    const { agent } = await import('./countdown.agent.js');
    const process = await agent.run({ task: 'go', config: { start: 1 } });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const last = events[events.length - 1]!;
    expect(last.type).toBe('result');
    expect((last.data as Record<string, unknown>).success).toBe(true);
  }, 10_000);

  it('timestamps are monotonically increasing', async () => {
    const { agent } = await import('./countdown.agent.js');
    const process = await agent.run({ task: 'go', config: { start: 1 } });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
    }
  }, 10_000);

  it('cancel stops iteration early', async () => {
    const { agent } = await import('./countdown.agent.js');
    const process = await agent.run({ task: 'go', config: { start: 5 } });
    const events: RunEvent[] = [];
    let count = 0;

    for await (const event of process.events) {
      events.push(event);
      count++;
      if (count >= 3) {
        process.cancel();
      }
    }

    // Should have fewer events than a full run (full = 12 outputs + 1 result = 13)
    expect(events.length).toBeLessThan(13);
  }, 10_000);

  it('cancel yields no result event', async () => {
    const { agent } = await import('./countdown.agent.js');
    const process = await agent.run({ task: 'go', config: { start: 5 } });
    const events: RunEvent[] = [];
    let count = 0;

    for await (const event of process.events) {
      events.push(event);
      count++;
      if (count >= 2) {
        process.cancel();
      }
    }

    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(0);
  }, 10_000);
});
