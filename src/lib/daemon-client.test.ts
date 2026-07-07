import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDaemonServer } from '../daemon/server.js';
import { writeTokenFile } from '../daemon/lifecycle.js';
import { VERSION } from '../utils/version.js';
import { type MemoryClient } from './memory-client.js';

const TOKEN = 'test-daemon-token';
import {
  createDaemonClient,
  ensureDaemon,
  health,
  type Health,
  mismatchNotice,
  waitForHealth,
} from './daemon-client.js';

const mockClient = (): MemoryClient => ({
  search: vi.fn(async () => ({ results: [] })),
  read: vi.fn(async () => ({
    path: 'a.md',
    title: 'A',
    frontmatter: {},
    body: 'hi',
    tags: [],
    updated: 'now',
    deleted: false,
  })),
  write: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  edit: vi.fn(async () => ({ path: 'a.md', rev: 'r', updated: 'now' })),
  list: vi.fn(async () => ({ folder: '', entries: [], truncated: false, files: 0 })),
  delete: vi.fn(async () => ({ path: 'a.md', deleted: true })),
});

// Spin the real daemon server IN-PROCESS on an ephemeral port - never fork (sandbox-safe).
const startServer = async (
  getClient: () => MemoryClient,
  version = '9.9.9'
): Promise<{ port: number; stop: () => Promise<void> }> => {
  const srv = createDaemonServer({
    getClient,
    authToken: TOKEN,
    version,
    startedAt: Date.now() - 3000,
  });
  await srv.start(0);
  const addr = srv.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { port, stop: () => srv.stop() };
};

// A shared config dir holds the token file the DaemonClient reads to authenticate its calls.
let configDir: string;
const savedConfigDir = process.env['AGENTAGE_CONFIG_DIR'];
beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'cli-daemon-client-'));
  process.env['AGENTAGE_CONFIG_DIR'] = configDir;
  writeTokenFile(TOKEN);
});
afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
  if (savedConfigDir === undefined) delete process.env['AGENTAGE_CONFIG_DIR'];
  else process.env['AGENTAGE_CONFIG_DIR'] = savedConfigDir;
});

afterEach(() => vi.restoreAllMocks());

describe('DaemonClient <-> server round trip', () => {
  it('routes all six verbs through the daemon and counts them', async () => {
    const c = mockClient();
    const { port, stop } = await startServer(() => c);
    try {
      const dc = createDaemonClient(port);
      expect((await dc.search('q', { limit: 3 })).results).toEqual([]);
      expect(c.search).toHaveBeenCalledWith('q', { limit: 3 });
      await dc.read('a.md', { vault: 'v' });
      expect(c.read).toHaveBeenCalledWith('a.md', { vault: 'v' });
      await dc.write('a.md', 'body', { frontmatter: { x: 1 } });
      expect(c.write).toHaveBeenCalledWith('a.md', 'body', { frontmatter: { x: 1 } });
      await dc.edit('a.md', { mode: 'append', body: 'y' }, {});
      await dc.list('notes', {});
      expect((await dc.delete('a.md')).deleted).toBe(true);

      const h = await health(port);
      expect(h?.served).toBeGreaterThanOrEqual(6);
      expect(h?.version).toBe('9.9.9');
    } finally {
      await stop();
    }
  });

  it('surfaces an engine error message across the wire', async () => {
    const c = mockClient();
    c.read = vi.fn(async () => {
      throw new Error('not found: x');
    });
    const { port, stop } = await startServer(() => c);
    try {
      await expect(createDaemonClient(port).read('x')).rejects.toThrow('not found: x');
    } finally {
      await stop();
    }
  });

  it('404s an unknown verb and unknown route, 400s a bad JSON body', async () => {
    const { port, stop } = await startServer(() => mockClient());
    try {
      const auth = { 'Content-Type': 'application/json', 'X-Agentage-Token': TOKEN };
      const bogus = await fetch(`http://127.0.0.1:${port}/api/memory/bogus`, {
        method: 'POST',
        headers: auth,
        body: '{}',
      });
      expect(bogus.status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
      const bad = await fetch(`http://127.0.0.1:${port}/api/memory/read`, {
        method: 'POST',
        headers: auth,
        body: '{oops',
      });
      expect(bad.status).toBe(400);
    } finally {
      await stop();
    }
  });
});

describe('health + waitForHealth', () => {
  it('waitForHealth resolves true against a live server', async () => {
    const { port, stop } = await startServer(() => mockClient());
    try {
      expect(await waitForHealth(port, { timeoutMs: 1000 })).toBe(true);
    } finally {
      await stop();
    }
  });

  it('health is null and waitForHealth times out on a dead port', async () => {
    const { port, stop } = await startServer(() => mockClient());
    await stop();
    expect(await health(port, 200)).toBeNull();
    expect(await waitForHealth(port, { timeoutMs: 250, intervalMs: 50 })).toBe(false);
  });
});

describe('mismatchNotice', () => {
  it('is null on a version match and a restart hint otherwise', () => {
    expect(mismatchNotice(VERSION)).toBeNull();
    expect(mismatchNotice('0.0.0-old')).toContain('agentage daemon stop && agentage daemon start');
  });
});

describe('ensureDaemon fallback logic', () => {
  const live: Health = { ok: true, version: VERSION, pid: 1, uptime: 1, served: 0 };

  it('uses an already-running daemon without spawning', async () => {
    const spawn = vi.fn(async () => true);
    const client = await ensureDaemon({ port: 40000, probe: async () => live, spawn });
    expect(client).not.toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('warns on a version mismatch but still returns a client', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = await ensureDaemon({
      port: 40000,
      probe: async () => ({ ...live, version: '0.0.0-old' }),
      spawn: async () => true,
    });
    expect(client).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('autostarts when absent, returns a client on success', async () => {
    const client = await ensureDaemon({
      port: 40000,
      probe: async () => null,
      spawn: async () => true,
    });
    expect(client).not.toBeNull();
  });

  it('returns null when absent and the fork is blocked', async () => {
    const client = await ensureDaemon({
      port: 40000,
      probe: async () => null,
      spawn: async () => false,
    });
    expect(client).toBeNull();
  });
});
