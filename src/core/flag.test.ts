import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginsEnabled } from './flag.js';

describe('pluginsEnabled', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env['AGENTAGE_PLUGINS'];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env['AGENTAGE_PLUGINS'];
    else process.env['AGENTAGE_PLUGINS'] = saved;
  });

  it('is off when the variable is unset', () => {
    delete process.env['AGENTAGE_PLUGINS'];
    expect(pluginsEnabled()).toBe(false);
  });

  it('is on only for the exact value 1', () => {
    process.env['AGENTAGE_PLUGINS'] = '1';
    expect(pluginsEnabled()).toBe(true);
  });

  it.each(['0', 'true', 'yes', ''])('stays off for %j', (value) => {
    process.env['AGENTAGE_PLUGINS'] = value;
    expect(pluginsEnabled()).toBe(false);
  });
});
