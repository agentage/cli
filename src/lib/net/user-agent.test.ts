import { describe, expect, it } from 'vitest';
import { requestHeaders } from './user-agent.js';
import { VERSION } from '../../utils/version.js';

describe('requestHeaders', () => {
  it('identifies a CLI request and reports the daemon version when present', () => {
    const headers = requestHeaders({ component: 'cli', daemonVersion: '1.2.3' });
    expect(headers['User-Agent']).toBe(`agentage-cli/${VERSION}`);
    expect(headers['X-Agentage-CLI-Version']).toBe(VERSION);
    expect(headers['X-Agentage-Daemon-Version']).toBe('1.2.3');
  });

  it('reports the daemon version as none on a CLI request when the daemon is stopped', () => {
    const headers = requestHeaders({ component: 'cli' });
    expect(headers['User-Agent']).toBe(`agentage-cli/${VERSION}`);
    expect(headers['X-Agentage-Daemon-Version']).toBe('none');
  });

  it('identifies a daemon request and reports its own version for both fields', () => {
    const headers = requestHeaders({ component: 'daemon' });
    expect(headers['User-Agent']).toBe(`agentage-daemon/${VERSION}`);
    expect(headers['X-Agentage-CLI-Version']).toBe(VERSION);
    expect(headers['X-Agentage-Daemon-Version']).toBe(VERSION);
  });
});
