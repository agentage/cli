import { describe, expect, it, vi } from 'vitest';
import { runStatus, type StatusDeps } from './status.js';
import { daemonOfStatus } from './status-daemon.js';

const FILE = { pid: 4321, port: 4243, version: '0.55.0', protocol: 1, startedBy: 'cli' };

const report = {
  version: '0.55.0',
  fqdn: 'agentage.io',
  env: 'production',
  target: { fqdn: 'agentage.io', env: 'production', reachable: true },
  auth: { signedIn: false },
  endpoint: { url: 'https://agentage.io/api', reachable: true },
  update: { status: { kind: 'current' }, message: null },
} as const;

describe('status names the one daemon (S1.2.3 row 6)', () => {
  it('starts or finds the daemon and gives its pid, port and version', async () => {
    const ensure = vi.fn(async () => 4243);
    const deps = { off: () => false, ensure, file: () => FILE };
    expect(await daemonOfStatus(deps)).toEqual({ pid: 4321, port: 4243, version: '0.55.0' });
    expect(ensure).toHaveBeenCalledOnce();
  });

  it('AGENTAGE_NO_DAEMON=1 starts none: null; a start that fails is null and one line', async () => {
    const ensure = vi.fn(async () => 4243);
    expect(await daemonOfStatus({ off: () => true, ensure, file: () => FILE })).toBeNull();
    expect(ensure).not.toHaveBeenCalled();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = async () => Promise.reject(new Error('port 4243 is in use'));
    expect(
      await daemonOfStatus({ off: () => false, ensure: failing, file: () => FILE })
    ).toBeNull();
    expect(err).toHaveBeenCalledWith('daemon: port 4243 is in use');
    err.mockRestore();
  });

  it('--json has daemon.pid, also when the extension side fails', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps: StatusDeps = {
      gather: async () => ({ ...report, update: { ...report.update } }),
      extensions: async () => Promise.reject(new Error('profile unreadable')),
      daemon: async () => ({ pid: 4321, port: 4243, version: '0.55.0' }),
    };
    await expect(runStatus({ json: true }, deps)).rejects.toThrow('profile unreadable');
    const json = JSON.parse(String(out.mock.calls[0]?.[0])) as { daemon: { pid: number } };
    expect(json.daemon).toEqual({ pid: 4321, port: 4243, version: '0.55.0' });
    out.mockRestore();
    err.mockRestore();
  });
});

describe('the report that closes setup', () => {
  it('has no daemon step: setup starts the daemon itself, or not at all', async () => {
    const { statusDeps } = await import('./status.js');
    expect(statusDeps(false).daemon).toBeUndefined();
    expect(statusDeps().daemon).toEqual(expect.any(Function));
  });
});
