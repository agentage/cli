import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module each test so the process-local `forced` flag never leaks between cases.
const load = async () => {
  vi.resetModules();
  return import('./daemon-pref.js');
};

describe('daemon preference', () => {
  const original = process.env['AGENTAGE_NO_DAEMON'];
  beforeEach(() => delete process.env['AGENTAGE_NO_DAEMON']);
  afterEach(() => {
    if (original === undefined) delete process.env['AGENTAGE_NO_DAEMON'];
    else process.env['AGENTAGE_NO_DAEMON'] = original;
  });

  it('is enabled by default', async () => {
    const { daemonDisabled } = await load();
    expect(daemonDisabled()).toBe(false);
  });

  it('disables via the env flag (1 or true)', async () => {
    const { daemonDisabled } = await load();
    process.env['AGENTAGE_NO_DAEMON'] = '1';
    expect(daemonDisabled()).toBe(true);
    process.env['AGENTAGE_NO_DAEMON'] = 'true';
    expect(daemonDisabled()).toBe(true);
    process.env['AGENTAGE_NO_DAEMON'] = '';
    expect(daemonDisabled()).toBe(false);
  });

  it('disableDaemon() latches the flag on', async () => {
    const { daemonDisabled, disableDaemon } = await load();
    expect(daemonDisabled()).toBe(false);
    disableDaemon();
    expect(daemonDisabled()).toBe(true);
  });
});
