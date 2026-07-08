import { describe, expect, it, vi } from 'vitest';
import { type StatusReport } from '../../lib/status/status-info.js';
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

  it('shows a stopped daemon row with the start hint and no mcp/sync lines', () => {
    const out = captureLines({ ...baseReport, daemon: { running: false, port: 4243 } });
    expect(out).toContain('daemon');
    expect(out).toContain('stopped - run: agentage daemon start');
    expect(out).not.toContain('mcp');
    expect(out).not.toContain('sync');
  });

  it('shows pid/port/uptime and the mcp endpoint when running with mcp on', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: true, pid: 321, port: 4243, uptimeSeconds: 3720, mcp: true },
    });
    expect(out).toContain('running (pid 321, port 4243, up 1h 2m)');
    expect(out).toContain('serving at http://127.0.0.1:4243/mcp');
  });

  it('marks mcp off when the daemon serves no /mcp endpoint', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: true, pid: 1, port: 4243, uptimeSeconds: 5, mcp: false },
    });
    expect(out).toContain('mcp');
    expect(out).toMatch(/mcp\s+\S+ off/);
  });

  it('renders a sync ok row with the vault count and last-run', () => {
    const out = captureLines({
      ...baseReport,
      daemon: {
        running: true,
        port: 4243,
        mcp: true,
        sync: { vaults: 3, state: 'ok', lastRun: '2026-07-08T10:00:00Z' },
      },
    });
    expect(out).toContain('3 vaults');
    expect(out).toContain('last ok 2026-07-08T10:00:00Z');
  });

  it('renders a sync error row with a short last error', () => {
    const out = captureLines({
      ...baseReport,
      daemon: {
        running: true,
        port: 4243,
        mcp: true,
        sync: { vaults: 1, state: 'error', lastError: 'push rejected\nmore detail here' },
      },
    });
    expect(out).toMatch(/sync\s+\S+ error \(push rejected\)/);
  });

  it('renders a syncing row while a cycle is in flight', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: true, port: 4243, mcp: true, sync: { vaults: 2, state: 'syncing' } },
    });
    expect(out).toContain('syncing');
  });

  it('renders a legacy daemon row (no pid/uptime) as running with a version note', () => {
    const out = captureLines({
      ...baseReport,
      version: '0.25.0',
      daemon: { running: true, port: 4243, mcp: true, daemonVersion: '0.0.3' },
    });
    expect(out).toMatch(/daemon\s+\S+ running \(pid \?, port 4243\)/);
    expect(out).toContain('version 0.0.3 != cli 0.25.0');
    expect(out).toContain('serving at http://127.0.0.1:4243/mcp');
  });

  it('appends a version-mismatch note to the running daemon row', () => {
    const out = captureLines({
      ...baseReport,
      version: '0.25.0',
      daemon: {
        running: true,
        pid: 9,
        port: 4243,
        uptimeSeconds: 1,
        mcp: true,
        daemonVersion: '0.24.0',
      },
    });
    expect(out).toContain('version 0.24.0 != cli 0.25.0');
  });
});
