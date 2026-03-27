import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('hello agent', () => {
  it('has correct manifest', async () => {
    const mod = await import('./hello.agent.js');
    const agent = mod.default;
    expect(agent.manifest.description).toBe('Says hello');
    expect(typeof agent.run).toBe('function');
  });

  it('yields greeting and auto-result', async () => {
    const mod = await import('./hello.agent.js');
    const process = await mod.default.run({ task: 'world' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect((events[0]!.data as Record<string, unknown>).content).toBe('Hello, world!');
    expect(events[1]!.type).toBe('result');
    expect((events[1]!.data as Record<string, unknown>).success).toBe(true);
  });
});
