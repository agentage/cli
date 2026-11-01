import { afterEach, describe, expect, vi } from 'vitest';
import { test, type ConfigDir } from '../../test/config-dir.js';
import { disposeAll } from './dispose.js';

// hello's own log, one parsed line per entry, without the timestamps.
const logOf = (dir: ConfigDir): Record<string, unknown>[] =>
  dir
    .file('logs/hello.log')
    .split('\n')
    .map((line) => Object.entries(JSON.parse(line) as Record<string, unknown>))
    .map((entries) => Object.fromEntries(entries.filter(([key]) => key !== 'at')));

describe("disposing an extension's subscriptions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('waits for one that takes 100 ms, abandons one that never ends at 5 s, and logs both', async ({
    dir,
  }) => {
    vi.useFakeTimers();
    let finished = false;
    const done = disposeAll('hello', [
      { dispose: () => new Promise<void>((resolve) => setTimeout(resolve, 100)) },
      { dispose: () => new Promise<void>(() => undefined) },
    ]).then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(logOf(dir)).toEqual([{ message: 'dispose', subscription: 0, result: 'done' }]);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(4_900);
    await done;
    expect(logOf(dir)[1]).toEqual({ message: 'dispose', subscription: 1, result: 'timeout' });
  });

  test('logs a dispose that throws with its message, and still disposes the others', async ({
    dir,
  }) => {
    let disposed = false;
    await disposeAll('hello', [
      {
        dispose: () => {
          throw new Error('stuck');
        },
      },
      { dispose: () => void (disposed = true) },
    ]);
    expect(disposed).toBe(true);
    expect(logOf(dir)).toEqual([
      { message: 'dispose', subscription: 0, result: 'stuck' },
      { message: 'dispose', subscription: 1, result: 'done' },
    ]);
  });
});
