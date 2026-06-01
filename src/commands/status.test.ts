import { describe, expect, it, vi } from 'vitest';
import { type StatusReport } from '../lib/status-info.js';
import { printStatus } from './status.js';

const baseReport: StatusReport = {
  version: '0.25.0',
  fqdn: 'agentage.io',
  env: 'production',
  auth: { signedIn: true, tokenExpiresAt: '2026-06-12T20:00:00Z' },
  endpoint: { url: 'https://agentage.io/api', reachable: true },
  update: { status: { kind: 'current' }, message: null },
};

const captureLines = (report: StatusReport): string => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    printStatus(report);
    return spy.mock.calls.map((call) => String(call[0])).join('\n');
  } finally {
    spy.mockRestore();
  }
};

describe('printStatus', () => {
  it('prints one line per fact when signed in', () => {
    const out = captureLines(baseReport);
    expect(out).toContain('0.25.0');
    expect(out).toContain('agentage.io (production)');
    expect(out).toContain('signed in');
    expect(out).toContain('2026-06-12T20:00:00Z');
    expect(out).toContain('reachable');
  });

  it('prints the setup hint when signed out', () => {
    const out = captureLines({
      ...baseReport,
      auth: { signedIn: false, note: 'not signed in - run: agentage setup' },
      endpoint: { url: 'https://agentage.io/api', reachable: false },
    });
    expect(out).toContain('run: agentage setup');
    expect(out).toContain('unreachable');
  });

  it('shows the install hint + server notice when an update is available', () => {
    const out = captureLines({
      ...baseReport,
      update: { status: { kind: 'update-available', latest: '0.3.0' }, message: 'heads up' },
    });
    expect(out).toContain('0.3.0 available');
    expect(out).toContain('npm i -g @agentage/cli@latest');
    expect(out).toContain('heads up');
  });

  it('flags an unsupported (below-floor) version as update-required', () => {
    const out = captureLines({
      ...baseReport,
      update: {
        status: { kind: 'unsupported', latest: '0.3.0', minSupported: '0.2.0' },
        message: null,
      },
    });
    expect(out).toContain('unsupported');
    expect(out).toContain('npm i -g @agentage/cli@latest');
  });
});
