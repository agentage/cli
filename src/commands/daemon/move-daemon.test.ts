import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { installedExtensions } from '../../core/loader/installed.js';
import { readHostToken } from '../../lib/daemon/daemon-file.js';
import { hostClient } from '../../lib/daemon/host-client.js';
import { output, test } from '../../test/config-dir.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { runConfigure, stdinInput } from '../extension/configure.js';
import { writeOldConfig } from '../../test/old-config.js';
import { MOVE_REPORT, MOVED_MARKER, moveOldLists } from './move.js';
import { runDaemon } from './run.js';
import { offlineInstaller as offline } from '../../test/host.js';
import { freePort } from '../../test/serve.js';

// /host/* needs the host token of daemon.json (D11).
const get = async <T = { msg: string }>(port: number, path: string): Promise<T> => {
  const headers = { authorization: `Bearer ${readHostToken() ?? ''}` };
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return ((await res.json()) as { data: T }).data;
};

type Row = { id: string; state: string };

// Spawns a child per extension; a sandbox that kills children fails this test, not skipped.
describe('a 0.51.1 config folder through the real daemon run (D6)', () => {
  test('moves every entry once, offline: states, settings, report, marker; a rerun changes nothing', async ({
    dir,
  }) => {
    writeOldConfig(dir.at('.'));
    const port = await freePort();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const running = runDaemon({ installer: offline, before: () => moveOldLists() });
    const settled = async () => {
      const rows = await get<Row[]>(port, '/host/extensions');
      expect(rows.length).toBe(4);
      expect(rows.every((r) => r.state !== 'starting')).toBe(true);
      return rows;
    };
    try {
      const rows = await vi.waitFor(settled, { timeout: 30_000, interval: 250 });
      expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toEqual({
        alpha: 'running',
        beta: 'running',
        devon: 'running',
        devoff: 'disabled',
      });
      expect((await get(port, '/api/alpha/echo?msg=hi')).msg).toBe('hey hi');
      expect((await get(port, '/api/beta/echo?msg=hi')).msg).toBe('hi hi');
      expect(dir.json('settings.json')).toEqual({
        alpha: { 'echo.prefix': 'hey' },
        beta: { 'echo.repeat': 2 },
      });
      expect(dir.json(MOVE_REPORT)).toMatchObject({
        moved: ['alpha', 'beta', 'devon', 'devoff'],
        skipped: expect.arrayContaining([
          { entry: 'alpha setting echo.repeat', reason: '"lots" does not fit its type' },
          {
            entry: expect.stringMatching(/unsafe$/),
            reason: expect.stringMatching(/world-writable/),
          },
        ]),
        warning: null,
      });
      expect(dir.exists(MOVED_MARKER)).toBe(true);
      const commands = (installedExtensions() ?? []).flatMap((e) => e.commands);
      expect(commands.sort()).toEqual(['alpha-ping', 'beta-ping', 'devon-ping']);
    } finally {
      process.emit('SIGTERM');
      await running;
    }
    const files = ['installation.json', 'settings.json', MOVE_REPORT].map((f) => dir.file(f));
    await moveOldLists();
    expect(['installation.json', 'settings.json', MOVE_REPORT].map((f) => dir.file(f))).toEqual(
      files
    );
    vi.unstubAllEnvs();
  }, 60_000);

  test('a move stopped after its first entry finishes on the next start, nothing lost', async ({
    dir,
  }) => {
    writeOldConfig(dir.at('.'));
    const stop = vi.fn(() => {
      throw new Error('killed');
    });
    await expect(moveOldLists({ entry: stop })).rejects.toThrow('killed');
    expect(dir.exists(MOVED_MARKER)).toBe(false);
    const first = dir.json('installation.json')['extensions'] as Row[];
    expect(first.map((r) => r.id)).toEqual(['alpha']);
    await moveOldLists();
    const rows = dir.json('installation.json')['extensions'] as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['alpha', 'beta', 'devon', 'devoff']);
    expect(dir.json('settings.json')).toEqual({
      alpha: { 'echo.prefix': 'hey' },
      beta: { 'echo.repeat': 2 },
    });
    expect(readFileSync(join(dir.at('.'), MOVED_MARKER), 'utf8')).toMatch(/^\d{4}-/);
  });

  test('configure sends text; the daemon makes an integer setting a number, a bad value is INVALID_SETTING', async () => {
    const port = await freePort();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const folder = writeKitExtension(mkdtempSync(join(tmpdir(), 'agentage-num-')), 'num', '0.1.0');
    const running = runDaemon({ installer: offline });
    const deps = { host: async () => hostClient(port), input: stdinInput(async () => '') };
    try {
      await vi.waitFor(() => get<Row[]>(port, '/host/extensions'), { timeout: 10_000 });
      await hostClient(port).add({ source: folder });
      await output(() => runConfigure({ id: 'num', pairs: ['echo.repeat=3'] }, deps));
      expect((await get(port, '/api/num/echo?msg=hi')).msg).toBe('hi hi hi');
      const bad = await output(() => runConfigure({ id: 'num', pairs: ['echo.repeat=x'] }, deps));
      expect(bad).toMatchObject({ code: 'INVALID_SETTING' });
      expect(bad.error).toMatch(/is not a valid integer/);
    } finally {
      process.emit('SIGTERM');
      await running;
      vi.unstubAllEnvs();
    }
  }, 60_000);
});
