import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { readRunState, writeRunState } from './state.js';

const RUN = { at: '2026-10-29T10:00:00.000Z', pid: 42, state: 'failed', error: 'boom' };

describe("an extension's last run", () => {
  test('is read from state/<id>.json; an absent error reads as none', ({ dir }) => {
    dir.write('state/hello.json', RUN);
    dir.write('state/world.json', { at: 't', pid: 1, state: 'ok' });
    expect(readRunState('hello')).toEqual(RUN);
    expect(readRunState('world')).toEqual({ at: 't', pid: 1, state: 'ok', error: null });
  });

  test.for([
    ['no file', null],
    ['a file that is not JSON', '{ nope'],
    ['a pid that is not a number', { at: 't', pid: '1', state: 'ok' }],
    ['a state it does not know', { at: 't', pid: 1, state: 'odd' }],
    ['an error that is not a string', { at: 't', pid: 1, state: 'ok', error: 3 }],
  ] as const)('is unknown with %s', ([, body], { dir }) => {
    if (body !== null) dir.write('state/hello.json', body);
    expect(readRunState('hello')).toBeNull();
  });

  test('is never read from a path built from an id outside the id pattern', ({ dir }) => {
    dir.write('state/x.json', { at: 't', pid: 1, state: 'ok' });
    expect(readRunState('../state/x')).toBeNull();
  });

  test('is written by the core as { at, pid, state, error }, readable only by this user', ({
    dir,
  }) => {
    writeRunState('hello', { state: 'failed', error: 'boom' });
    expect(readRunState('hello')).toEqual({
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      pid: process.pid,
      state: 'failed',
      error: 'boom',
    });
    expect(statSync(dir.at('state/hello.json')).mode & 0o777).toBe(0o600);
  });
});
