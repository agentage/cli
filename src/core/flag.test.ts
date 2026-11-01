import { afterEach, describe, expect, it } from 'vitest';
import { extensionsEnabled } from './flag.js';

describe('the extensions switch', () => {
  const saved = process.env['AGENTAGE_EXTENSIONS'];

  afterEach(() => {
    if (saved === undefined) delete process.env['AGENTAGE_EXTENSIONS'];
    else process.env['AGENTAGE_EXTENSIONS'] = saved;
  });

  it('is on only when AGENTAGE_EXTENSIONS is exactly 1', () => {
    process.env['AGENTAGE_EXTENSIONS'] = '1';
    expect(extensionsEnabled()).toBe(true);
  });

  it('is off when unset or set to anything else', () => {
    delete process.env['AGENTAGE_EXTENSIONS'];
    expect(extensionsEnabled()).toBe(false);
    for (const value of ['0', 'true', 'yes', '']) {
      process.env['AGENTAGE_EXTENSIONS'] = value;
      expect(extensionsEnabled(), value).toBe(false);
    }
  });
});
