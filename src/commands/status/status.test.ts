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
  vaults: [],
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

  it('renders a per-vault block with name, channel, and status', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: true, port: 4243, mcp: true },
      vaults: [
        { name: 'notes', channel: 'cloud', status: 'ok', lastRun: '2026-07-08T18:40:00Z' },
        { name: 'work', channel: 'git', status: 'error', lastError: 'auth failed\ndetail' },
      ],
    });
    expect(out).toMatch(/vaults\s+2 connected/);
    expect(out).toMatch(/notes\s+cloud\s+\S+ last ok/);
    expect(out).toMatch(/work\s+git\s+\S+ error \(auth failed\)/);
  });

  it('renders a syncing vault while a cycle is in flight', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: true, port: 4243, mcp: true },
      vaults: [{ name: 'work', channel: 'git', status: 'syncing' }],
    });
    expect(out).toMatch(/work\s+git\s+\S+ syncing/);
  });

  it('marks a local-only vault as idle, not connected, with a singular count', () => {
    const out = captureLines({
      ...baseReport,
      vaults: [{ name: 'scratch', channel: 'local', status: 'idle' }],
    });
    expect(out).toMatch(/vaults\s+1 vault\b/);
    expect(out).not.toContain('1 vaults');
    expect(out).toMatch(/scratch\s+local\s+.*local only/);
  });

  it('pluralizes the count for multiple local-only vaults', () => {
    const out = captureLines({
      ...baseReport,
      vaults: [
        { name: 'a', channel: 'local', status: 'idle' },
        { name: 'b', channel: 'local', status: 'idle' },
      ],
    });
    expect(out).toMatch(/vaults\s+2 vaults\b/);
  });

  it('lists configured vaults as unknown when the daemon is stopped', () => {
    const out = captureLines({
      ...baseReport,
      daemon: { running: false, port: 4243 },
      vaults: [{ name: 'notes', channel: 'cloud', status: 'unknown' }],
    });
    expect(out).toMatch(/notes\s+cloud\s+.*unknown \(daemon stopped\)/);
  });

  it('prints an actionable hint when there are zero vaults', () => {
    const out = captureLines({ ...baseReport, vaults: [] });
    expect(out).toMatch(/vaults\s+none - run: agentage vault add/);
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
