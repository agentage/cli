import { spawn } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { markOf, proven, startedAt, stopProven } from './start-time.js';

describe('a process proven by pid and start time', () => {
  test('this process has a start time that does not change; a dead pid has none', () => {
    const first = startedAt(process.pid);
    expect(first).not.toBeNull();
    expect(startedAt(process.pid)).toBe(first);
    expect(startedAt(2 ** 22 + 7)).toBeNull();
    expect(startedAt(0)).toBeNull();
  });

  test('a reused pid (same pid, another start time) is not proven and is never signalled', () => {
    const mark = { pid: process.pid, started: 'another start' };
    expect(proven(mark)).toBe(false);
    expect(stopProven(mark)).toBe(false);
    expect(proven(null)).toBe(false);
    expect(markOf(process.pid, () => null)).toBeNull();
    expect(markOf(undefined)).toBeNull();
  });

  test('a proven child gets SIGTERM', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    const mark = markOf(child.pid);
    expect(mark).not.toBeNull();
    const exited = new Promise((done) => child.once('exit', (_c, signal) => done(signal)));
    expect(stopProven(mark!)).toBe(true);
    expect(await exited).toBe('SIGTERM');
  });
});
