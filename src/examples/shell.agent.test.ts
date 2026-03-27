import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('shell agent', () => {
  it('has correct manifest', async () => {
    const { default: agent } = await import('./shell.agent.js');
    expect(agent.manifest.name).toBe('shell');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });

  it('executes command and yields output', async () => {
    const { default: agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'echo hello-shell' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const outputs = events.filter(
      (e) => e.type === 'output' && (e.data as Record<string, unknown>).format === 'text'
    );
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    expect((outputs[0]!.data as Record<string, unknown>).content).toBe('hello-shell');
  });

  it('yields result with exit code', async () => {
    const { default: agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'true' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const last = events[events.length - 1]!;
    expect(last.type).toBe('result');
    expect((last.data as Record<string, unknown>).success).toBe(true);
  });
});
