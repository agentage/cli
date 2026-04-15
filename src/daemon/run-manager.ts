import { randomUUID } from 'node:crypto';
import {
  type Agent,
  type AgentProcess,
  type AgentRuntime,
  type CtxRunFn,
  type CtxRunResult,
  type Run,
  type RunEvent,
  type RunInput,
  canTransition,
} from '@agentage/core';
import { logError, logInfo } from './logger.js';
import { validateOutput, type JsonSchema } from '../utils/schema-input.js';
import { getAgents } from './routes.js';

// Augment core Run with lineage info. Will move into @agentage/core canonically
// once the Phase 2 composition work stabilises.
declare module '@agentage/core' {
  interface Run {
    parentRunId?: string;
    depth?: number;
  }
}

type RunEventListener = (runId: string, event: RunEvent) => void;
type RunStateListener = (run: Run) => void;
type RunStartedListener = (run: Run) => void;

interface TrackedRun {
  run: Run;
  process: AgentProcess;
  outputSchema?: JsonSchema;
  childRunIds: Set<string>;
}

const TERMINAL_STATES: Run['state'][] = ['completed', 'failed', 'canceled'];
const RUN_CLEANUP_TTL_MS = 5 * 60_000; // Clean up terminal runs after 5 minutes

const runs = new Map<string, TrackedRun>();
const eventListeners = new Set<RunEventListener>();
const stateListeners = new Set<RunStateListener>();
const startedListeners = new Set<RunStartedListener>();

export const onRunEvent = (listener: RunEventListener): (() => void) => {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
};

export const onRunStateChange = (listener: RunStateListener): (() => void) => {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
};

export const onRunStarted = (listener: RunStartedListener): (() => void) => {
  startedListeners.add(listener);
  return () => startedListeners.delete(listener);
};

const emitEvent = (runId: string, event: RunEvent): void => {
  for (const listener of eventListeners) {
    listener(runId, event);
  }
};

const emitStateChange = (run: Run): void => {
  for (const listener of stateListeners) {
    listener(run);
  }
};

const updateRunState = (
  tracked: TrackedRun,
  newState: Run['state'],
  extra?: Partial<Run>
): void => {
  if (!canTransition(tracked.run.state, newState)) {
    logError(
      `Invalid state transition: ${tracked.run.state} → ${newState} for run ${tracked.run.id}`
    );
    return;
  }
  tracked.run.state = newState;
  if (extra) {
    Object.assign(tracked.run, extra);
  }
  emitStateChange(tracked.run);

  // Schedule cleanup for terminal runs to prevent memory leak
  if (TERMINAL_STATES.includes(newState)) {
    setTimeout(() => {
      runs.delete(tracked.run.id);
    }, RUN_CLEANUP_TTL_MS);
  }
};

interface StartRunOptions {
  parentRunId?: string;
  depth?: number;
}

export const DAEMON_DEPTH_LIMIT = 50;

/**
 * Build a daemon-side runtime that honours ctx.run() inside agent code.
 * - registry: resolves agent names against the daemon's discovered agents
 * - dispatch: creates a linked child run, streams its events to the parent
 *   iterator, and returns the final CtxRunResult
 */
const buildRuntime = (parentRunId: string, parentDepth: number): AgentRuntime => {
  const registry = {
    async resolve(ref: string): Promise<Agent | null> {
      return getAgents().find((a) => a.manifest.name === ref) ?? null;
    },
  };

  const dispatch: CtxRunFn = async function* <O = unknown>(
    ref: string | Agent,
    input: RunInput
  ): AsyncGenerator<RunEvent, CtxRunResult<O>, void> {
    const nextDepth = parentDepth + 1;
    if (nextDepth > DAEMON_DEPTH_LIMIT) {
      return { success: false, error: `ctx.run depth limit exceeded (${DAEMON_DEPTH_LIMIT})` };
    }

    let child: Agent | null;
    if (typeof ref === 'string') {
      child = await registry.resolve(ref);
      if (!child) {
        return { success: false, error: `agent "${ref}" not found` };
      }
    } else {
      child = ref;
    }

    let childRunId: string;
    try {
      childRunId = await startRun(
        child,
        input.task ?? '',
        input.config,
        input.context,
        input.project,
        { parentRunId, depth: nextDepth }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `failed to start child run: ${message}` };
    }

    const parent = runs.get(parentRunId);
    parent?.childRunIds.add(childRunId);

    // Stream child events back to the parent iterator (the daemon already
    // fan-outs to event listeners via consumeEvents; this surfaces the same
    // events through the parent agent's generator so the author can observe
    // them if they iterate the yielded events).
    const childTracked = runs.get(childRunId);
    let finalResult: CtxRunResult<O> = { success: true };
    if (childTracked) {
      for await (const event of childTracked.process.events) {
        yield event;
        if (event.data.type === 'result') {
          finalResult = {
            success: event.data.success,
            output: event.data.output as O,
            error: event.data.success ? undefined : 'child run returned unsuccessful result',
          };
        }
      }
    }
    return finalResult;
  };

  return { registry, dispatch, parentRunId, depth: parentDepth };
};

export const startRun = async (
  agent: Agent,
  task: string,
  config?: Record<string, unknown>,
  context?: string[],
  project?: { name: string; path: string; branch?: string; remote?: string },
  options: StartRunOptions = {}
): Promise<string> => {
  const runId = randomUUID();
  const depth = options.depth ?? 0;
  const run: Run = {
    id: runId,
    agentName: agent.manifest.name,
    input: task,
    state: 'submitted',
    createdAt: Date.now(),
    ...(options.parentRunId && { parentRunId: options.parentRunId }),
    ...(depth > 0 && { depth }),
  };

  logInfo(
    `Starting run ${runId} for agent "${agent.manifest.name}"${options.parentRunId ? ` (child of ${options.parentRunId})` : ''}`
  );

  const runInput = { task, config, context, ...(project && { project }) };
  const runtime = buildRuntime(runId, depth);
  const process = await agent.run(runInput, runtime);
  const outputSchema = (agent.manifest as { outputSchema?: JsonSchema }).outputSchema;
  const tracked: TrackedRun = { run, process, outputSchema, childRunIds: new Set() };
  runs.set(runId, tracked);

  // Fire startedListeners BEFORE the first state change so subscribers (hub-ws)
  // can register their event/state forwarders first.
  for (const listener of startedListeners) {
    try {
      listener(run);
    } catch (err) {
      logError(`onRunStarted listener threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateRunState(tracked, 'working', { startedAt: Date.now() });

  // Consume events in background
  consumeEvents(tracked).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Run ${runId} failed: ${message}`);
    updateRunState(tracked, 'failed', { error: message, endedAt: Date.now() });
  });

  return runId;
};

const consumeEvents = async (tracked: TrackedRun): Promise<void> => {
  for await (const event of tracked.process.events) {
    emitEvent(tracked.run.id, event);

    if (event.data.type === 'state') {
      updateRunState(tracked, event.data.state);
    }

    if (event.data.type === 'result') {
      let success = event.data.success;
      let errorMessage = success ? undefined : 'Agent returned unsuccessful result';

      if (success && tracked.outputSchema && event.data.output !== undefined) {
        const validation = validateOutput(tracked.outputSchema, event.data.output);
        if (!validation.ok) {
          success = false;
          errorMessage = `Output does not match agent outputSchema:\n${validation.errors
            .map((e) => `  • ${e}`)
            .join('\n')}`;
          logError(`Run ${tracked.run.id}: ${errorMessage}`);
        }
      }

      updateRunState(tracked, success ? 'completed' : 'failed', {
        endedAt: Date.now(),
        error: errorMessage,
      });
    }

    if (event.data.type === 'error' && !event.data.recoverable) {
      updateRunState(tracked, 'failed', {
        error: event.data.message,
        endedAt: Date.now(),
      });
    }

    if (event.data.type === 'input_required') {
      if (canTransition(tracked.run.state, 'input_required')) {
        updateRunState(tracked, 'input_required');
      }
    }
  }

  // If events ended without a terminal state, mark completed
  if (!TERMINAL_STATES.includes(tracked.run.state)) {
    updateRunState(tracked, 'completed', { endedAt: Date.now() });
  }
};

export const cancelRun = (runId: string): boolean => {
  const tracked = runs.get(runId);
  if (!tracked) return false;
  if (!canTransition(tracked.run.state, 'canceled')) return false;

  tracked.process.cancel();
  // Cascade to children — cooperative cancel via their AbortSignal. Agentkit's
  // makeCtxRun already wires parent->child signal propagation in-process, but
  // we cancel here too so the daemon's state machine marks the child runs as
  // canceled even if the agent didn't iterate the child generator.
  for (const childId of tracked.childRunIds) {
    cancelRun(childId);
  }
  updateRunState(tracked, 'canceled', { endedAt: Date.now() });
  logInfo(`Run ${runId} canceled`);
  return true;
};

export const sendInput = (runId: string, text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const tracked = runs.get(runId);
  if (!tracked) return false;
  if (tracked.run.state !== 'input_required') return false;

  tracked.process.sendInput(text);
  updateRunState(tracked, 'working');
  return true;
};

export const getRuns = (): Run[] => [...runs.values()].map((t) => t.run);

export const getRun = (runId: string): Run | undefined => runs.get(runId)?.run;

export const cancelAllRuns = (): void => {
  for (const [runId, tracked] of runs) {
    if (canTransition(tracked.run.state, 'canceled')) {
      tracked.process.cancel();
      updateRunState(tracked, 'canceled', { endedAt: Date.now() });
      logInfo(`Run ${runId} canceled (shutdown)`);
    }
  }
};
