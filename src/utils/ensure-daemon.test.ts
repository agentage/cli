import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../daemon/daemon.js', () => ({
  isDaemonRunning: vi.fn(),
  startDaemon: vi.fn(),
  restartDaemon: vi.fn(),
}));

vi.mock('./daemon-client.js', () => ({
  get: vi.fn(),
}));

import { ensureDaemon } from './ensure-daemon.js';
import { isDaemonRunning, startDaemon, restartDaemon } from '../daemon/daemon.js';
import { get } from './daemon-client.js';
import { VERSION } from './version.js';

describe('ensureDaemon', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns immediately when daemon is running with matching version', async () => {
    vi.mocked(isDaemonRunning).mockReturnValue(true);
    vi.mocked(get).mockResolvedValue({ version: VERSION });

    await ensureDaemon();

    expect(get).toHaveBeenCalledWith('/api/health');
    expect(startDaemon).not.toHaveBeenCalled();
    expect(restartDaemon).not.toHaveBeenCalled();
  });

  it('restarts daemon when running version differs from CLI version', async () => {
    vi.mocked(isDaemonRunning).mockReturnValue(true);
    vi.mocked(get).mockResolvedValue({ version: 'mismatched-version' });

    await ensureDaemon();

    expect(restartDaemon).toHaveBeenCalledOnce();
    expect(startDaemon).not.toHaveBeenCalled();
  });

  it('starts daemon when not running', async () => {
    vi.mocked(isDaemonRunning).mockReturnValue(false);

    await ensureDaemon();

    expect(startDaemon).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(restartDaemon).not.toHaveBeenCalled();
  });

  it('swallows health-check errors without restarting', async () => {
    vi.mocked(isDaemonRunning).mockReturnValue(true);
    vi.mocked(get).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(ensureDaemon()).resolves.toBeUndefined();
    expect(restartDaemon).not.toHaveBeenCalled();
    expect(startDaemon).not.toHaveBeenCalled();
  });
});
