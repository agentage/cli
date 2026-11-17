import { describe, expect, it, vi } from 'vitest';
import { type DaemonFile } from '../../lib/daemon/daemon-file.js';
import { startedByOf } from './run.js';
import { runDaemonStart } from './start.js';

const FILE: DaemonFile = {
  pid: 4321,
  port: 4999,
  version: '0.57.0',
  protocol: 1,
  startedBy: 'desktop',
  hostToken: 'secret-token',
};

describe('agentage daemon start', () => {
  it('connects or starts, then names pid, url, protocol and startedBy, never the host token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const found = await runDaemonStart(
      async () => 4999,
      () => FILE
    );
    expect(found).toEqual({
      pid: 4321,
      url: 'http://127.0.0.1:4999',
      protocol: 1,
      startedBy: 'desktop',
    });
    expect(log).toHaveBeenCalledWith(
      'daemon: running on 127.0.0.1:4999, pid 4321, started by desktop'
    );
    expect(JSON.stringify([found, log.mock.calls])).not.toContain('secret-token');
    log.mockRestore();
  });

  it('fails as daemon_unavailable when daemon.json does not name the daemon that answered', async () => {
    await expect(
      runDaemonStart(
        async () => 4243,
        () => FILE
      )
    ).rejects.toMatchObject({
      code: 'daemon_unavailable',
    });
    await expect(
      runDaemonStart(
        async () => 4243,
        () => null
      )
    ).rejects.toMatchObject({
      code: 'daemon_unavailable',
    });
  });
});

describe('AGENTAGE_STARTED_BY', () => {
  it.each([
    [undefined, 'cli'],
    ['', 'cli'],
    ['desktop', 'desktop'],
    ['cli', 'cli'],
    ['robot', 'cli'],
  ])('%s starts the daemon as %s', (raw, expected) => {
    expect(startedByOf(raw === undefined ? {} : { AGENTAGE_STARTED_BY: raw })).toBe(expected);
  });
});
