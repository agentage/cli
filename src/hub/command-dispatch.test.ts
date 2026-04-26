import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../daemon/logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

import type { ActionRegistry, InvokeEvent } from '@agentage/core';
import { dispatchInvokeAction } from './command-dispatch.js';
import { resetActionRegistry } from '../daemon/actions.js';

// Stub the registry singleton with a controllable yielder per test by mocking
// the actions module. Each test resets the singleton, then mocks
// getActionRegistry to return a fake whose .invoke yields a scripted sequence.
import type * as ActionsModule from '../daemon/actions.js';

vi.mock('../daemon/actions.js', async (importActual) => {
  const actual = await importActual<typeof ActionsModule>();
  return {
    ...actual,
    getActionRegistry: vi.fn(),
  };
});

import { getActionRegistry } from '../daemon/actions.js';

const mockRegistry = (
  events: InvokeEvent[] | (() => AsyncGenerator<InvokeEvent>)
): ActionRegistry => {
  const invoke =
    typeof events === 'function'
      ? events
      : async function* () {
          for (const e of events) yield e;
        };
  return {
    register: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    invoke: invoke as ActionRegistry['invoke'],
  };
};

describe('dispatchInvokeAction', () => {
  beforeEach(() => {
    resetActionRegistry();
    vi.mocked(getActionRegistry).mockReset();
  });

  it('streams accepted → progress → result through the send callback with monotonic ordinals', async () => {
    vi.mocked(getActionRegistry).mockReturnValue(
      mockRegistry([
        { type: 'accepted', invocationId: 'inv-1' },
        { type: 'progress', data: { step: 'install' } },
        { type: 'result', data: { ok: true } },
      ])
    );
    const sent: unknown[] = [];

    await dispatchInvokeAction(
      { commandId: 'cmd-1', action: 'cli:update', input: { target: 'latest' } },
      (m) => sent.push(m)
    );

    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({
      type: 'command_event',
      commandId: 'cmd-1',
      ordinal: 0,
      event: { type: 'accepted', data: { invocationId: 'inv-1' } },
    });
    expect(sent[1]).toMatchObject({
      ordinal: 1,
      event: { type: 'progress', data: { step: 'install' } },
    });
    expect(sent[2]).toMatchObject({
      ordinal: 2,
      event: { type: 'result', data: { ok: true } },
    });
  });

  it('forwards an error event with code/message/retryable', async () => {
    vi.mocked(getActionRegistry).mockReturnValue(
      mockRegistry([
        {
          type: 'error',
          code: 'EXECUTION_FAILED',
          message: 'boom',
          retryable: true,
        },
      ])
    );
    const sent: unknown[] = [];

    await dispatchInvokeAction({ commandId: 'cmd-2', action: 'cli:update', input: {} }, (m) =>
      sent.push(m)
    );

    expect(sent[0]).toMatchObject({
      event: {
        type: 'error',
        data: { code: 'EXECUTION_FAILED', message: 'boom', retryable: true },
      },
    });
  });

  it('catches a thrown registry exception and emits a synthetic error frame', async () => {
    vi.mocked(getActionRegistry).mockReturnValue(
      mockRegistry(async function* () {
        throw new Error('registry crashed');
      })
    );
    const sent: Array<{ event: { type: string; data: unknown } }> = [];

    await dispatchInvokeAction({ commandId: 'cmd-3', action: 'cli:update', input: {} }, (m) =>
      sent.push(m as never)
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: {
        type: 'error',
        data: { code: 'EXECUTION_FAILED', message: 'registry crashed', retryable: false },
      },
    });
  });
});
