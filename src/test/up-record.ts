import { startedAt, type ProcessMark } from '../lib/proc/start-time.js';
import { type UpRecord } from '../commands/extension/up-local.js';

// An up record: `pid` proven with its real start time, or `started` given (a reused pid).
export const rec = (
  pid: number,
  added: boolean,
  started?: string,
  tsc?: ProcessMark
): UpRecord => ({
  up: { pid, started: started ?? startedAt(pid) ?? 'gone' },
  nonce: 'n1',
  id: 'demo',
  added,
  ...(tsc && { tsc }),
});

// A pid no process has.
export const ENDED = 999_999_999;
