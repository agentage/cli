import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Agent, type RunEvent } from '@agentage/core';

const testDir = join(tmpdir(), `agentage-test-rm-${Date.now()}`);

describe('run-manager', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  const createMockAgent = (name: string, events: RunEvent[]): Agent => ({
    manifest: { name, path: '/test', description: `Test agent ${name}` },
    async run() {
      const canceled = { value: false };

      async function* gen(): AsyncIterable<RunEvent> {
        for (const event of events) {
          if (canceled.value) return;
          yield event;
        }
      }

      return {
        runId: 'test-run',
        events: gen(),
        cancel: () => {
          canceled.value = true;
        },
        sendInput: () => {},
      };
    },
  });

  it('starts a run and returns a runId', async () => {
    const { startRun } = await import('./run-manager.js');
    const agent = createMockAgent('test', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    const runId = await startRun(agent, 'hello');
    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
  });

  it('tracks runs in getRuns', async () => {
    const { startRun, getRuns } = await import('./run-manager.js');
    const agent = createMockAgent('test2', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    await startRun(agent, 'hello');

    // Small delay for event consumption
    await new Promise((r) => setTimeout(r, 50));

    const runs = getRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it('gets a single run by id', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const agent = createMockAgent('test3', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    const runId = await startRun(agent, 'hello');
    const run = getRun(runId);
    expect(run).toBeDefined();
    expect(run?.id).toBe(runId);
    expect(run?.agentName).toBe('test3');
  });

  it('emits events to listeners', async () => {
    const { startRun, onRunEvent } = await import('./run-manager.js');
    const receivedEvents: RunEvent[] = [];

    onRunEvent((_runId, event) => {
      receivedEvents.push(event);
    });

    const agent = createMockAgent('test4', [
      {
        type: 'output',
        data: { type: 'output', content: 'hello', format: 'text' },
        timestamp: Date.now(),
      },
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    await startRun(agent, 'hello');
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('concurrent runs allowed', async () => {
    const { startRun } = await import('./run-manager.js');
    const agent1 = createMockAgent('agent-a', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);
    const agent2 = createMockAgent('agent-b', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    const [id1, id2] = await Promise.all([startRun(agent1, 'task1'), startRun(agent2, 'task2')]);

    expect(id1).not.toBe(id2);
  });

  it('cancelRun returns false for unknown run', async () => {
    const { cancelRun } = await import('./run-manager.js');
    expect(cancelRun('nonexistent')).toBe(false);
  });

  it('sendInput returns false for unknown run', async () => {
    const { sendInput } = await import('./run-manager.js');
    expect(sendInput('nonexistent', 'text')).toBe(false);
  });

  it('getRun returns undefined for unknown run', async () => {
    const { getRun } = await import('./run-manager.js');
    expect(getRun('nonexistent')).toBeUndefined();
  });

  it('handles failed result event', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const agent = createMockAgent('fail-agent', [
      { type: 'result', data: { type: 'result', success: false }, timestamp: Date.now() },
    ]);

    const runId = await startRun(agent, 'fail');
    await new Promise((r) => setTimeout(r, 100));

    const run = getRun(runId);
    expect(run?.state).toBe('failed');
  });

  it('handles non-recoverable error event', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const agent = createMockAgent('error-agent', [
      {
        type: 'error',
        data: { type: 'error', code: 'FATAL', message: 'boom', recoverable: false },
        timestamp: Date.now(),
      },
    ]);

    const runId = await startRun(agent, 'err');
    await new Promise((r) => setTimeout(r, 100));

    const run = getRun(runId);
    expect(run?.state).toBe('failed');
    expect(run?.error).toBe('boom');
  });

  it('cancelAllRuns cancels active runs', async () => {
    const { startRun, cancelAllRuns, getRun } = await import('./run-manager.js');

    // Create a slow agent that yields many events
    const slowAgent: Agent = {
      manifest: { name: 'slow-cancel', path: '/test' },
      async run() {
        async function* gen(): AsyncIterable<RunEvent> {
          for (let i = 0; i < 100; i++) {
            yield {
              type: 'output',
              data: { type: 'output', content: `step ${i}`, format: 'text' },
              timestamp: Date.now(),
            };
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        return {
          runId: 'slow',
          events: gen(),
          cancel: () => {},
          sendInput: () => {},
        };
      },
    };

    const runId = await startRun(slowAgent, 'go');
    await new Promise((r) => setTimeout(r, 50));

    cancelAllRuns();
    const run = getRun(runId);
    expect(run?.state).toBe('canceled');
  });

  it('handles input_required event and sendInput', async () => {
    const { startRun, getRun, sendInput } = await import('./run-manager.js');

    let resolveInput: (() => void) | undefined;
    const inputPromise = new Promise<void>((r) => {
      resolveInput = r;
    });

    const agent: Agent = {
      manifest: { name: 'input-agent', path: '/test' },
      async run() {
        async function* gen(): AsyncIterable<RunEvent> {
          yield {
            type: 'input_required',
            data: { type: 'input_required', prompt: 'Enter name:' },
            timestamp: Date.now(),
          };
          // Wait for input
          await inputPromise;
          yield {
            type: 'result',
            data: { type: 'result', success: true },
            timestamp: Date.now(),
          };
        }
        return {
          runId: 'input-test',
          events: gen(),
          cancel: () => {},
          sendInput: () => {
            resolveInput?.();
          },
        };
      },
    };

    const runId = await startRun(agent, 'do input');
    await new Promise((r) => setTimeout(r, 100));

    const run = getRun(runId);
    expect(run?.state).toBe('input_required');

    const ok = sendInput(runId, 'John');
    expect(ok).toBe(true);
  });

  it('sendInput returns false when not in input_required state', async () => {
    const { startRun, sendInput } = await import('./run-manager.js');
    const agent = createMockAgent('no-input', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    const runId = await startRun(agent, 'test');
    await new Promise((r) => setTimeout(r, 100));

    // Run is likely completed, not input_required
    expect(sendInput(runId, 'text')).toBe(false);
  });

  it('emits state changes to listeners', async () => {
    const { startRun, onRunStateChange } = await import('./run-manager.js');
    const stateChanges: string[] = [];

    onRunStateChange((run) => {
      stateChanges.push(run.state);
    });

    const agent = createMockAgent('state-test', [
      { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
    ]);

    await startRun(agent, 'hello');
    await new Promise((r) => setTimeout(r, 100));

    expect(stateChanges).toContain('working');
    expect(stateChanges).toContain('completed');
  });
});
