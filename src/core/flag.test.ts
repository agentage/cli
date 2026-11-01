import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modulesEnabled } from './flag.js';

describe('modulesEnabled', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env['AGENTAGE_MODULES'];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env['AGENTAGE_MODULES'];
    else process.env['AGENTAGE_MODULES'] = saved;
  });

  it('is off when the variable is unset', () => {
    delete process.env['AGENTAGE_MODULES'];
    expect(modulesEnabled()).toBe(false);
  });

  it('is on only for the exact value 1', () => {
    process.env['AGENTAGE_MODULES'] = '1';
    expect(modulesEnabled()).toBe(true);
  });

  it.each(['0', 'true', 'yes', ''])('stays off for %j', (value) => {
    process.env['AGENTAGE_MODULES'] = value;
    expect(modulesEnabled()).toBe(false);
  });
});
