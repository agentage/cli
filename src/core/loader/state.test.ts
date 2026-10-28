import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRunState } from './state.js';

describe('readRunState', () => {
  let dir: string;

  const write = (id: string, body: unknown): void => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(join(dir, 'state', `${id}.json`), JSON.stringify(body));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-state-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads state/<id>.json under the config dir', () => {
    write('hello', { at: '2026-10-29T10:00:00.000Z', pid: 42, state: 'failed', error: 'boom' });
    expect(readRunState('hello')).toEqual({
      at: '2026-10-29T10:00:00.000Z',
      pid: 42,
      state: 'failed',
      error: 'boom',
    });
  });

  it('normalises an absent error to null', () => {
    write('hello', { at: 't', pid: 1, state: 'ok' });
    expect(readRunState('hello')?.error).toBeNull();
  });

  it('is null for a missing, malformed or wrong-shaped file', () => {
    expect(readRunState('hello')).toBeNull();
    for (const body of [
      {},
      { at: 't', pid: '1', state: 'ok' },
      { at: 't', pid: 1, state: 'odd' },
    ]) {
      write('hello', body);
      expect(readRunState('hello'), JSON.stringify(body)).toBeNull();
    }
    write('hello', { at: 't', pid: 1, state: 'ok', error: 3 });
    expect(readRunState('hello')).toBeNull();
  });

  it('never builds a path from an id outside the id pattern', () => {
    write('x', { at: 't', pid: 1, state: 'ok' });
    expect(readRunState('../state/x')).toBeNull();
    expect(readRunState('x', { dir: () => join(dir, 'state') })?.state).toBe('ok');
  });
});
