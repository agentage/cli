// Daemon-side dispatcher for hub→daemon `invoke-action` requests.
// Single entry point used by both:
//   - hub-ws.ts (when an `invoke-action` arrives on the live WS)
//   - hub-sync.ts (when the heartbeat response carries queued invoke-actions
//                  that the WS-push branch missed during a flap)
//
// Streams `command_event` frames back to the hub via the supplied `send`
// callback. Each frame carries a per-command monotonic ordinal so the hub
// can replay deterministically across reconnects (the hub-side schema has a
// UNIQUE constraint on (command_id, ordinal) per α.1).
//
// Full design: work/tasks/daemon-command-bridge

import type { InvokeEvent, InvokeRequest } from '@agentage/core';
import { logError, logInfo } from '../daemon/logger.js';
import { getActionRegistry } from '../daemon/actions.js';

export interface InvokeActionCommand {
  commandId: string;
  action: string;
  version?: string;
  input: unknown;
  idempotencyKey?: string;
}

export interface CommandEventEnvelope {
  type: 'command_event';
  commandId: string;
  ordinal: number;
  event: {
    type: 'accepted' | 'progress' | 'result' | 'error';
    data: unknown;
    timestamp: number;
  };
}

const mapInvokeEventToWire = (e: InvokeEvent): CommandEventEnvelope['event'] => {
  switch (e.type) {
    case 'accepted':
      return { type: 'accepted', data: { invocationId: e.invocationId }, timestamp: Date.now() };
    case 'progress':
      return { type: 'progress', data: e.data, timestamp: Date.now() };
    case 'result':
      return { type: 'result', data: e.data, timestamp: Date.now() };
    case 'error':
      return {
        type: 'error',
        data: { code: e.code, message: e.message, retryable: e.retryable },
        timestamp: Date.now(),
      };
  }
};

/**
 * Run one invoke-action through the local ActionRegistry and stream its
 * lifecycle events back over `send`. Errors yielded by the registry surface
 * as `{ event.type: 'error' }` frames; thrown errors (registry contract
 * violation) are caught and surfaced the same way so the hub-side row never
 * gets stuck mid-stream.
 */
export const dispatchInvokeAction = async (
  cmd: InvokeActionCommand,
  send: (msg: unknown) => void
): Promise<void> => {
  const registry = getActionRegistry();

  const req: InvokeRequest = {
    action: cmd.action,
    version: cmd.version,
    input: cmd.input,
    idempotencyKey: cmd.idempotencyKey,
    // MVP: the hub authenticates the user; daemon trusts the hub. Once
    // capability gating ships server-side we'll thread the resolved set
    // through here (see work/tasks/daemon-command-bridge § Open choices).
    callerId: 'hub',
    capabilities: ['*'],
  };

  let ordinal = 0;
  const emit = (event: CommandEventEnvelope['event']): void => {
    send({
      type: 'command_event',
      commandId: cmd.commandId,
      ordinal: ordinal++,
      event,
    });
  };

  logInfo(`[command-dispatch] invoking ${cmd.action} (commandId=${cmd.commandId})`);

  try {
    for await (const event of registry.invoke(req)) {
      emit(mapInvokeEventToWire(event));
    }
  } catch (err) {
    // Registry.invoke contract: errors yield as `{ type: 'error' }` events.
    // A thrown exception means the registry itself crashed — surface as a
    // synthetic error frame so the hub row terminates cleanly.
    logError(
      `[command-dispatch] ${cmd.action} threw: ${err instanceof Error ? err.message : String(err)}`
    );
    emit({
      type: 'error',
      data: {
        code: 'EXECUTION_FAILED',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
      timestamp: Date.now(),
    });
  }
};
