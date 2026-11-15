import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { movedSettings } from './move-settings.js';

const declaring = (settings?: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agentage-settings-'));
  const agentage = settings ? { id: 'x', settings } : { id: 'x' };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', agentage }));
  return dir;
};

describe('the settings the move carries', () => {
  it('turns each value into the declared type, or drops and reports it', () => {
    const dir = declaring({
      s: { type: 'string', default: '' },
      b: { type: 'boolean', default: false },
      n: { type: 'number', default: 0 },
      i: { type: 'integer', default: 0 },
      e: { type: 'string', default: 'a', enum: ['a', 'b'] },
    });
    const config = { s: 5, b: 'true', n: '1.5', i: '1.5', e: 'c', gone: 1 };
    expect(movedSettings('x', dir, config)).toEqual({
      settings: { s: '5', b: true, n: 1.5 },
      dropped: [
        { entry: 'x setting i', reason: '"1.5" does not fit its type' },
        { entry: 'x setting e', reason: '"c" does not fit its type' },
        { entry: 'x setting gone', reason: 'not declared' },
      ],
    });
  });

  it('keeps every value of an extension that declares no settings', () => {
    const config = { any: { nested: true } };
    expect(movedSettings('x', declaring(), config)).toEqual({ settings: config, dropped: [] });
  });
});
