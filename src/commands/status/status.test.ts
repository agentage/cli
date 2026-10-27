import { describe, expect, it, vi } from 'vitest';
import { type StatusReport } from '../../lib/status/status-info.js';
import { printStatus } from './status.js';

// A future expiry proves the report can carry it while the human line still ignores it.
const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();

const baseReport: StatusReport = {
  version: '0.25.0',
  fqdn: 'agentage.io',
  env: 'production',
  target: { fqdn: 'agentage.io', env: 'production', reachable: true },
  auth: { signedIn: true, tokenExpiresAt: futureExpiry },
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
    expect(out).toContain('signed in (session active)');
    expect(out).toContain('reachable');
  });

  it('marks the target line reachable with a check when the site is up', () => {
    const out = captureLines(baseReport);
    expect(out).toMatch(/target\s+\S+ agentage\.io \(production\)/);
    expect(out).not.toContain('agentage.io (production) - unreachable');
  });

  it('marks the target line unreachable with a cross when the site is down', () => {
    const out = captureLines({
      ...baseReport,
      target: { fqdn: 'agentage.io', env: 'production', reachable: false },
    });
    expect(out).toContain('agentage.io (production) - unreachable');
  });

  it('shows session active for a future-expiry session, never the timestamp', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const out = captureLines({ ...baseReport, auth: { signedIn: true, tokenExpiresAt: future } });
    expect(out).toContain('signed in (session active)');
    expect(out).not.toContain(future);
    expect(out).not.toContain('token valid until');
  });

  it('shows session active for a past-expiry session, never the timestamp', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const out = captureLines({ ...baseReport, auth: { signedIn: true, tokenExpiresAt: past } });
    expect(out).not.toContain(past);
    expect(out).not.toContain('token valid until');
    expect(out).toContain('signed in (session active)');
  });

  it('shows session active when signed in without any expiry', () => {
    const out = captureLines({ ...baseReport, auth: { signedIn: true } });
    expect(out).toContain('signed in (session active)');
  });

  it('renders a neutral env-mismatch line naming both sides, never expired', () => {
    const out = captureLines({
      ...baseReport,
      auth: {
        signedIn: false,
        mismatch: {
          credentialFqdn: 'dev.agentage.io',
          credentialEnv: 'development',
          targetFqdn: 'agentage.io',
          targetEnv: 'production',
        },
        note: 'signed in to dev.agentage.io - CLI targets agentage.io (production)',
      },
    });
    expect(out).toContain('signed in to dev.agentage.io');
    expect(out).toContain('CLI targets agentage.io (production)');
    expect(out).not.toContain('session expired');
    expect(out).not.toContain('✗');
    expect(out).toContain('!');
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
