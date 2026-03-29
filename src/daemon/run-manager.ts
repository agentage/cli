import { randomUUID } from 'node:crypto';
import {
  type Agent,
  type AgentProcess,
  type Run,
  type RunEvent,
  canTransition,
} from '@agentage/core';
import { logError, logInfo } from './logger.js';

type RunEventListener = (runId: string, event: RunEvent) => void;
type RunStateListener = (run: Run) => void;

interface TrackedRun {
  run: Run;
  process: AgentProcess;
}

const TERMINAL_STATES: Run['state'][] = ['completed', 'failed', 'canceled'];
const RUN_CLEANUP_TTL_MS = 5 * 60_000; // Clean up terminal runs after 5 minutes

const runs = new Map<string, TrackedRun>();
const eventListeners = new Set<RunEventListener>();
const stateListeners = new Set<RunStateListener>();

export const onRunEvent = (listener: RunEventListener): (() => void) => {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
};

export const onRunStateChange = (listener: RunStateListener): (() => void) => {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
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

export const startRun = async (
  agent: Agent,
  task: string,
  config?: Record<string, unknown>,
  context?: string[]
): Promise<string> => {
  const runId = randomUUID();
  const run: Run = {
    id: runId,
    agentName: agent.manifest.name,
    input: task,
    state: 'submitted',
    createdAt: Date.now(),
  };

  logInfo(`Starting run ${runId} for agent "${agent.manifest.name}"`);

  const process = await agent.run({ task, config, context });
  const tracked: TrackedRun = { run, process };
  runs.set(runId, tracked);

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
      updateRunState(tracked, event.data.success ? 'completed' : 'failed', {
        endedAt: Date.now(),
        error: event.data.success ? undefined : 'Agent returned unsuccessful result',
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
