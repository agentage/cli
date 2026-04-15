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

  const createMockAgent = (
    name: string,
    events: RunEvent[],
    extra?: Record<string, unknown>
  ): Agent => ({
    manifest: { name, path: '/test', description: `Test agent ${name}`, ...extra },
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

  /**
   * A code-style agent that can call ctx.run (because it accepts the runtime
   * arg). Yields events from the child run; forwards the child's result as its
   * own with an optional wrapping transform.
   */
  interface ChildCallAgentOpts {
    childRef: string;
    onChildResult?: (success: boolean, output: unknown) => RunEvent;
  }
  const createParentAgent = (name: string, opts: ChildCallAgentOpts): Agent => ({
    manifest: { name, path: '/test', description: `Parent ${name}` },
    async run(_input, runtime?: unknown) {
      const dispatch = (runtime as { dispatch?: Function } | undefined)?.dispatch;
      const controller = new AbortController();
      async function* events(): AsyncIterable<RunEvent> {
        if (!dispatch) {
          yield {
            type: 'result',
            data: { type: 'result', success: false, output: 'no dispatch' },
            timestamp: Date.now(),
          };
          return;
        }
        const gen = dispatch(opts.childRef, { task: '' }) as AsyncGenerator<
          RunEvent,
          { success: boolean; output?: unknown; error?: string }
        >;
        let final: { success: boolean; output?: unknown; error?: string } = { success: true };
        while (true) {
          const next = await gen.next();
          if (next.done) {
            final = next.value;
            break;
          }
          yield next.value;
        }
        if (opts.onChildResult) {
          yield opts.onChildResult(final.success, final.output);
        } else {
          yield {
            type: 'result',
            data: {
              type: 'result',
              success: final.success,
              output: final.output,
            },
            timestamp: Date.now(),
          };
        }
      }
      return {
        runId: 'parent-run',
        events: events(),
        cancel: () => controller.abort(),
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

  it('marks run failed when result.output mismatches outputSchema', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const outputSchema = {
      type: 'object',
      properties: { verdict: { type: 'string', enum: ['approve', 'reject'] } },
      required: ['verdict'],
      additionalProperties: false,
    };
    const agent = createMockAgent(
      'schema-fail',
      [
        {
          type: 'result',
          data: { type: 'result', success: true, output: { verdict: 'maybe' } },
          timestamp: Date.now(),
        },
      ],
      { outputSchema }
    );

    const runId = await startRun(agent, 't');
    await new Promise((r) => setTimeout(r, 100));

    const run = getRun(runId);
    expect(run?.state).toBe('failed');
    expect(run?.error).toMatch(/outputSchema/);
  });

  it('marks run completed when output matches schema', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const outputSchema = {
      type: 'object',
      properties: { verdict: { type: 'string', enum: ['approve', 'reject'] } },
      required: ['verdict'],
    };
    const agent = createMockAgent(
      'schema-ok',
      [
        {
          type: 'result',
          data: { type: 'result', success: true, output: { verdict: 'approve' } },
          timestamp: Date.now(),
        },
      ],
      { outputSchema }
    );

    const runId = await startRun(agent, 't');
    await new Promise((r) => setTimeout(r, 100));

    expect(getRun(runId)?.state).toBe('completed');
  });

  it('skips output validation when outputSchema is absent', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const agent = createMockAgent('no-schema', [
      {
        type: 'result',
        data: { type: 'result', success: true, output: { anything: 'goes' } },
        timestamp: Date.now(),
      },
    ]);

    const runId = await startRun(agent, 't');
    await new Promise((r) => setTimeout(r, 100));

    expect(getRun(runId)?.state).toBe('completed');
  });

  it('skips output validation when result has no output', async () => {
    const { startRun, getRun } = await import('./run-manager.js');
    const outputSchema = {
      type: 'object',
      required: ['verdict'],
      properties: { verdict: { type: 'string' } },
    };
    const agent = createMockAgent(
      'no-output',
      [{ type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() }],
      { outputSchema }
    );

    const runId = await startRun(agent, 't');
    await new Promise((r) => setTimeout(r, 100));

    // success=true with no output is allowed (back-compat).
    expect(getRun(runId)?.state).toBe('completed');
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

  describe('onRunStarted', () => {
    it('fires for top-level runs with no parentRunId', async () => {
      const { startRun, onRunStarted } = await import('./run-manager.js');
      const seen: Array<{ id: string; parentRunId?: string }> = [];
      const unsub = onRunStarted((run) => {
        seen.push({ id: run.id, parentRunId: run.parentRunId });
      });

      const agent = createMockAgent('top-level', [
        { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
      ]);
      const runId = await startRun(agent, 't');

      expect(seen.length).toBeGreaterThanOrEqual(1);
      const self = seen.find((s) => s.id === runId);
      expect(self).toBeDefined();
      expect(self?.parentRunId).toBeUndefined();
      unsub();
    });

    it('fires for ctx.run children with parentRunId and depth set', async () => {
      const { startRun, onRunStarted } = await import('./run-manager.js');
      const { setAgents } = await import('./routes.js');
      const seen: Array<{ id: string; parentRunId?: string; depth?: number }> = [];
      const unsub = onRunStarted((run) => {
        seen.push({ id: run.id, parentRunId: run.parentRunId, depth: run.depth });
      });

      const child = createMockAgent('child-started', [
        { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
      ]);
      setAgents([child]);

      const parent = createParentAgent('parent-started', { childRef: 'child-started' });
      const parentId = await startRun(parent, 't');
      await new Promise((r) => setTimeout(r, 50));

      const childEvent = seen.find((s) => s.parentRunId === parentId);
      expect(childEvent).toBeDefined();
      expect(childEvent?.depth).toBe(1);
      unsub();
    });

    it('listener errors do not break startRun', async () => {
      const { startRun, onRunStarted } = await import('./run-manager.js');
      const unsub = onRunStarted(() => {
        throw new Error('listener boom');
      });

      const agent = createMockAgent('tolerant', [
        { type: 'result', data: { type: 'result', success: true }, timestamp: Date.now() },
      ]);
      await expect(startRun(agent, 't')).resolves.toBeDefined();
      unsub();
    });
  });

  describe('ctx.run — daemon dispatch', () => {
    it('creates a linked child run when parent calls ctx.run', async () => {
      const { startRun, getRuns } = await import('./run-manager.js');
      const { setAgents } = await import('./routes.js');

      const child = createMockAgent('child', [
        {
          type: 'result',
          data: { type: 'result', success: true, output: { value: 42 } },
          timestamp: Date.now(),
        },
      ]);
      setAgents([child]);

      const parent = createParentAgent('parent', { childRef: 'child' });
      const parentRunId = await startRun(parent, 't');
      await new Promise((r) => setTimeout(r, 50));

      const allRuns = getRuns();
      const childRun = allRuns.find((r) => r.agentName === 'child');
      expect(childRun).toBeDefined();
      expect(childRun?.parentRunId).toBe(parentRunId);
      expect(childRun?.depth).toBe(1);
    });

    it('returns error result for unknown child ref, parent continues', async () => {
      const { startRun, getRun } = await import('./run-manager.js');
      const { setAgents } = await import('./routes.js');
      setAgents([]);

      const parent = createParentAgent('parent-unknown', {
        childRef: 'does-not-exist',
        onChildResult: (success, output) => ({
          type: 'result',
          data: {
            type: 'result',
            success: true,
            output: { childSuccess: success, childOutput: output },
          },
          timestamp: Date.now(),
        }),
      });

      const runId = await startRun(parent, 't');
      await new Promise((r) => setTimeout(r, 50));

      // Parent completes successfully, carrying the child's error as its output.
      expect(getRun(runId)?.state).toBe('completed');
    });

    it('cancelling parent also cancels children', async () => {
      const { startRun, cancelRun, getRuns } = await import('./run-manager.js');
      const { setAgents } = await import('./routes.js');

      // Slow child: yields result only when iterated; we cancel before that.
      let childCancelled = false;
      const child: Agent = {
        manifest: { name: 'slow-child', path: '/test', description: 'slow' },
        async run() {
          async function* events(): AsyncIterable<RunEvent> {
            await new Promise((r) => setTimeout(r, 500));
            yield {
              type: 'result',
              data: { type: 'result', success: true },
              timestamp: Date.now(),
            };
          }
          return {
            runId: 'c',
            events: events(),
            cancel: () => {
              childCancelled = true;
            },
            sendInput: () => {},
          };
        },
      };
      setAgents([child]);

      const parent = createParentAgent('parent-cancel', { childRef: 'slow-child' });
      const parentRunId = await startRun(parent, 't');
      await new Promise((r) => setTimeout(r, 20));

      cancelRun(parentRunId);
      await new Promise((r) => setTimeout(r, 50));

      expect(childCancelled).toBe(true);
      const children = getRuns().filter((r) => r.parentRunId === parentRunId);
      // Child run state may be "canceled" (cascade) or still transitioning.
      expect(children.length).toBeGreaterThan(0);
    });
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
