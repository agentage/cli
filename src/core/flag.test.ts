import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionsEnabled } from './flag.js';

describe('extensionsEnabled', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env['AGENTAGE_EXTENSIONS'];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env['AGENTAGE_EXTENSIONS'];
    else process.env['AGENTAGE_EXTENSIONS'] = saved;
  });

  it('is off when the variable is unset', () => {
    delete process.env['AGENTAGE_EXTENSIONS'];
    expect(extensionsEnabled()).toBe(false);
  });

  it('is on only for the exact value 1', () => {
    process.env['AGENTAGE_EXTENSIONS'] = '1';
    expect(extensionsEnabled()).toBe(true);
  });

  it.each(['0', 'true', 'yes', ''])('stays off for %j', (value) => {
    process.env['AGENTAGE_EXTENSIONS'] = value;
    expect(extensionsEnabled()).toBe(false);
  });
});
