import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthState } from '../fs/config.js';
import { fetchJsonUnref } from '../net/http.js';
import { gatherStatus } from './status-info.js';

vi.mock('../net/http.js', () => ({ fetchJsonUnref: vi.fn() }));
const httpMock = vi.mocked(fetchJsonUnref);

const auth: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'at', refreshToken: 'rt' },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// health + the npm-registry update check go through fetchJsonUnref (node:https); introspection
// (get-session) still uses global fetch via authedGet.
const stubHttp = (health: 'reachable' | 'unreachable'): void => {
  httpMock.mockImplementation((url: string) => {
    if (url.endsWith('/latest'))
      return Promise.resolve({ ok: true, status: 200, json: { version: '0.0.0' } });
    if (url.endsWith('/health'))
      return Promise.resolve(health === 'reachable' ? { ok: true, status: 200, json: {} } : null);
    return Promise.resolve(null);
  });
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentage-status-'));
  process.env['AGENTAGE_CONFIG_DIR'] = dir;
  stubHttp('reachable');
});

afterEach(() => {
  delete process.env['AGENTAGE_CONFIG_DIR'];
  rmSync(dir, { recursive: true, force: true });
  httpMock.mockReset();
  vi.unstubAllGlobals();
});

describe('gatherStatus', () => {
  it('reports a degraded status when not signed in', async () => {
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.env).toBe('development');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('agentage setup');
    expect(report.endpoint.reachable).toBe(true);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marks the endpoint unreachable on network failure', async () => {
    stubHttp('unreachable');
    const report = await gatherStatus(null, 'agentage.io');
    expect(report.endpoint.reachable).toBe(false);
  });

  it('reports signed-in with token expiry when introspection succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: '2026-06-12T20:00:00Z' })
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth).toEqual({ signedIn: true, tokenExpiresAt: '2026-06-12T20:00:00Z' });
  });

  it('refreshes on a 200 + null session and reports signed-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('/token'))
          return Promise.resolve(jsonResponse(200, { access_token: 'new', expires_in: 60 }));
        const bearer = (init?.headers as Record<string, string> | undefined)?.['authorization'];
        return Promise.resolve(
          bearer === 'Bearer new'
            ? jsonResponse(200, { userId: 'u1', accessTokenExpiresAt: 'x' })
            : jsonResponse(200, null)
        );
      })
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(true);
    expect(report.auth.note).toBeUndefined();
  });

  it('reports session expired when the 200 + null refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/token') ? jsonResponse(400, {}) : jsonResponse(200, null)
        )
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toBe('session expired - run: agentage setup');
  });

  it('downgrades to signed-out with a hint when the token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/token') ? jsonResponse(400, {}) : jsonResponse(401, {})
        )
      )
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('session expired');
  });

  it('reports verification failures without claiming signed-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, {}))
    );
    const report = await gatherStatus(auth, 'dev.agentage.io');
    expect(report.auth.signedIn).toBe(false);
    expect(report.auth.note).toContain('could not verify session');
  });

  it('reports the daemon as stopped when no pidfile is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, null))
    );
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon).toEqual({ running: false, port: 4243 });
  });
});

// Simulate a running daemon: our own live pid + port on disk, plus a fetch stub answering the
// daemon's /api/health and /api/sync/status. Exercises probeDaemon + summarizeSync end to end.
describe('gatherStatus daemon probe', () => {
  const port = 4271;

  const bootPidFiles = (): void => {
    writeFileSync(join(dir, 'daemon.pid'), String(process.pid), 'utf-8');
    writeFileSync(join(dir, 'daemon.port'), String(port), 'utf-8');
  };

  const stubDaemon = (health: unknown, sync: unknown): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/api/health')) return Promise.resolve(jsonResponse(200, health));
        if (String(url).includes('/api/sync/status'))
          return Promise.resolve(jsonResponse(200, sync));
        return Promise.resolve(jsonResponse(200, null));
      })
    );
    process.env['AGENTAGE_DAEMON_PORT'] = String(port);
  };

  afterEach(() => delete process.env['AGENTAGE_DAEMON_PORT']);

  it('reports pid, uptime, mcp on, and an ok sync summary', async () => {
    bootPidFiles();
    stubDaemon(
      { ok: true, version: '9.9.9', pid: process.pid, uptime: 42, served: 0, mcp: true },
      { vaults: [{ vault: 'a', running: false, lastRun: '2026-07-08T10:00:00Z' }] }
    );
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.running).toBe(true);
    expect(report.daemon?.uptimeSeconds).toBe(42);
    expect(report.daemon?.mcp).toBe(true);
    expect(report.daemon?.daemonVersion).toBe('9.9.9');
    expect(report.daemon?.sync).toEqual({
      vaults: 1,
      state: 'ok',
      lastRun: '2026-07-08T10:00:00Z',
      lastError: undefined,
    });
  });

  it('marks mcp off and folds an error across git + couch vaults', async () => {
    bootPidFiles();
    stubDaemon(
      { ok: true, version: '9.9.9', pid: process.pid, uptime: 5, served: 0, mcp: false },
      {
        vaults: [{ vault: 'a', running: true, lastRun: '2026-07-08T09:00:00Z' }],
        couch: [{ vault: 'b', running: false, lastError: 'push rejected', pendingCount: 0 }],
      }
    );
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.mcp).toBe(false);
    expect(report.daemon?.sync?.vaults).toBe(2);
    expect(report.daemon?.sync?.state).toBe('error');
    expect(report.daemon?.sync?.lastError).toBe('push rejected');
  });

  it('classifies a legacy 0.0.3 daemon (health lacks mcp/pid/uptime) as running', async () => {
    // No pidfile written: a legacy daemon that never wrote this config dir's pidfile.
    stubDaemon({ ok: true, version: '0.0.3' }, { vaults: [] });
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.running).toBe(true);
    expect(report.daemon?.daemonVersion).toBe('0.0.3');
    expect(report.daemon?.pid).toBeUndefined();
    expect(report.daemon?.uptimeSeconds).toBeUndefined();
    // Absent mcp on a legacy daemon reads as serving (on), not off.
    expect(report.daemon?.mcp).toBe(true);
  });

  it('omits the sync summary when the daemon serves no vaults', async () => {
    bootPidFiles();
    stubDaemon(
      { ok: true, version: '9.9.9', pid: process.pid, uptime: 5, served: 0, mcp: true },
      { vaults: [] }
    );
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.running).toBe(true);
    expect(report.daemon?.sync).toBeUndefined();
  });

  it('still reports running from a live pidfile when /health is briefly unreachable', async () => {
    bootPidFiles();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    );
    process.env['AGENTAGE_DAEMON_PORT'] = String(port);
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.running).toBe(true);
  });

  it('reports stopped when no pidfile and /health is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    );
    process.env['AGENTAGE_DAEMON_PORT'] = String(port);
    const report = await gatherStatus(null, 'dev.agentage.io');
    expect(report.daemon?.running).toBe(false);
  });
});
