import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@agentage/core';

describe('shell agent', () => {
  it('has correct manifest', async () => {
    const { agent } = await import('./shell.agent.js');
    expect(agent.manifest.name).toBe('shell');
    expect(agent.manifest.description).toBeDefined();
    expect(typeof agent.run).toBe('function');
  });

  it('runs echo and returns output', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'echo hello' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const outputs = events.filter(
      (e) => e.type === 'output' && (e.data as Record<string, unknown>).format === 'text'
    );
    expect(outputs.length).toBeGreaterThan(0);
    expect((outputs[0]!.data as Record<string, unknown>).content).toBe('hello');
  }, 10_000);

  it('streams multi-line output', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'printf "a\\nb\\nc\\n"' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const outputs = events.filter(
      (e) => e.type === 'output' && (e.data as Record<string, unknown>).format === 'text'
    );
    expect(outputs).toHaveLength(3);
  }, 10_000);

  it('exit code 0 means success', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'true' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    expect((result!.data as Record<string, unknown>).success).toBe(true);
  }, 10_000);

  it('exit code 1 means failure', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'exit 1' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    expect((result!.data as Record<string, unknown>).success).toBe(false);
  }, 10_000);

  it('captures stderr as error events', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'echo err >&2' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const errors = events.filter((e) => e.type === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0]!.data as Record<string, unknown>).recoverable).toBe(true);
  }, 10_000);

  it('empty command yields error', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: '' });
    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    expect((result!.data as Record<string, unknown>).success).toBe(false);
  }, 10_000);

  it('cancel kills subprocess', async () => {
    const { agent } = await import('./shell.agent.js');
    const process = await agent.run({ task: 'sleep 60' });

    // Cancel immediately
    setTimeout(() => process.cancel(), 100);

    const events: RunEvent[] = [];
    for await (const event of process.events) {
      events.push(event);
    }

    // Should complete quickly (not wait 60s)
    // No result event expected when canceled
  }, 5_000);
});
