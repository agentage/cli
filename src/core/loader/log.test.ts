import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { extensionLog, LOG_CAP_BYTES } from './log.js';

describe('ctx.log', () => {
  test('appends one JSON line per call to logs/<id>.log, readable only by this user', ({ dir }) => {
    const log = extensionLog('hello');
    log('registered', { greeting: 'hello' });
    log('done');
    const lines = dir.file('logs/hello.log').split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { at: expect.any(String), message: 'registered', greeting: 'hello' },
      { at: expect.any(String), message: 'done' },
    ]);
    expect(statSync(dir.at('logs/hello.log')).mode & 0o777).toBe(0o600);
  });

  test('past 1 MB keeps its newest half, starting on a whole line', ({ dir }) => {
    const log = extensionLog('hello');
    const filler = 'x'.repeat(1_000);
    for (let n = 0; n < 1_100; n += 1) log('line', { n, filler });
    const size = statSync(dir.at('logs/hello.log')).size;
    expect(size).toBeLessThanOrEqual(LOG_CAP_BYTES);
    const lines = dir.file('logs/hello.log').split('\n');
    expect(() => lines.map((line) => JSON.parse(line) as unknown)).not.toThrow();
    expect(JSON.parse(lines.at(-1) ?? '')).toMatchObject({ n: 1_099 });
  });
});
