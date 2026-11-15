import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { daemonPort, isAlive, readDaemonFile, removeDaemonFile } from './daemon-file.js';

describe('daemon.json and the port', () => {
  test('the port is AGENTAGE_DAEMON_PORT when it is a port, else 4243', () => {
    expect(daemonPort({ AGENTAGE_DAEMON_PORT: '4300' })).toBe(4300);
    expect(daemonPort({})).toBe(4243);
    expect(daemonPort({ AGENTAGE_DAEMON_PORT: 'x' })).toBe(4243);
    expect(daemonPort({ AGENTAGE_DAEMON_PORT: '70000' })).toBe(4243);
  });

  test('daemon.json is read when it names a pid and a port, and removed', ({ dir }) => {
    expect(readDaemonFile()).toBeNull();
    for (const pid of ['x', 0, -1, 1]) {
      dir.write('daemon.json', { pid, port: 1 });
      expect(readDaemonFile(), String(pid)).toBeNull();
    }
    dir.write('daemon.json', { pid: 12, port: 4243, version: '1.0.0' });
    expect(readDaemonFile()).toMatchObject({ pid: 12, port: 4243 });
    removeDaemonFile();
    removeDaemonFile();
    expect(dir.exists('daemon.json')).toBe(false);
  });

  test('a pid is alive while its process runs', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(2 ** 22 + 7)).toBe(false);
    // 0 and -1 would signal a process group, 1 is init: none is a daemon pid.
    for (const pid of [0, -1, 1, 1.5, Number.NaN]) expect(isAlive(pid), String(pid)).toBe(false);
  });
});
