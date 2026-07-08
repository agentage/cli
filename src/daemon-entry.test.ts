import { describe, expect, it, vi } from 'vitest';
import { createStateCleanup, isEaddrinuse, mcpEnabled, safeReschedule } from './daemon-entry.js';

describe('mcpEnabled', () => {
  it('serves MCP by default and only AGENTAGE_DAEMON_NO_MCP=1 turns it off', () => {
    expect(mcpEnabled({})).toBe(true);
    expect(mcpEnabled({ AGENTAGE_DAEMON_NO_MCP: '0' })).toBe(true);
    expect(mcpEnabled({ AGENTAGE_DAEMON_NO_MCP: '' })).toBe(true);
    expect(mcpEnabled({ AGENTAGE_DAEMON_NO_MCP: '1' })).toBe(false);
  });
});

describe('isEaddrinuse', () => {
  it('is true only for an error carrying the EADDRINUSE code', () => {
    const busy = new Error('port 4243 already in use') as NodeJS.ErrnoException;
    busy.code = 'EADDRINUSE';
    expect(isEaddrinuse(busy)).toBe(true);
    expect(isEaddrinuse(new Error('other'))).toBe(false);
    expect(isEaddrinuse(null)).toBe(false);
    expect(isEaddrinuse('EADDRINUSE')).toBe(false);
  });
});

describe('createStateCleanup', () => {
  it('never removes files before ownership is marked (race loser leaves the winner alone)', () => {
    const remove = vi.fn();
    const state = createStateCleanup(remove);
    state.cleanup();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes files only after ownership is marked', () => {
    const remove = vi.fn();
    const state = createStateCleanup(remove);
    state.markOwned();
    state.cleanup();
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe('safeReschedule', () => {
  it('runs every step even when one throws, logging the failure', () => {
    const onError = vi.fn();
    const ran: string[] = [];
    safeReschedule(
      [
        () => ran.push('a'),
        () => {
          throw new Error('bad config');
        },
        () => ran.push('c'),
      ],
      onError
    );
    expect(ran).toEqual(['a', 'c']);
    expect(onError).toHaveBeenCalledWith('bad config');
  });
});
