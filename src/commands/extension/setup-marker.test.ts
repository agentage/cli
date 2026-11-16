import { describe, expect, vi } from 'vitest';
import { type Profile } from '../../core/profile/schema.js';
import { DaemonError } from '../../lib/json-output.js';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { readMarker, writeMarker } from './setup-marker.js';
import { installThroughDaemon } from './setup-install.js';

const profile = (ids: string[]): Profile => ({
  version: 1,
  extensions: Object.fromEntries(ids.map((id) => [`@agentage/extension-${id}`, '^1'])),
  registries: {},
  config: {},
  machines: {},
  extra: {},
});

const failedRow = (id: string) => ({
  ...marketRow(id, '1.0.0'),
  state: 'failed',
  error: 'needs secret KEY',
});

describe('the account setup marker names the entries that failed', () => {
  test('a later setup tries only the failed ids, exits 0 and names each that still fails', async () => {
    const fake = fakeHost([marketRow('a', '1.0.0'), failedRow('b')]);
    writeMarker([
      { id: 'b', row: true },
      { id: 'c', row: false },
    ]);
    const add = vi.mocked(fake.host.add).getMockImplementation()!;
    vi.mocked(fake.host.add).mockImplementation(async (body) => {
      if ('id' in body && body.id === 'c') throw new DaemonError('NOT_FOUND', 'no c');
      return add(body);
    });
    const deps = { host: async () => fake.host, daemonOff: false, from: 'account' as const };
    const run = await output(() => installThroughDaemon(profile(['a', 'b', 'c']), deps));
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'b: needs secret KEY (still fails; the next setup tries it again)',
      'c: no c (still fails; the next setup tries it again)',
    ]);
    expect(fake.host.add).toHaveBeenCalledTimes(2);
    expect(readMarker()).toEqual([
      { id: 'b', row: true },
      { id: 'c', row: false },
    ]);
  });

  test('a failed row the user removed is not added again; a 0.52 marker has nothing to retry', async ({
    dir,
  }) => {
    const fake = fakeHost([]);
    writeMarker([{ id: 'b', row: true }]);
    const deps = { host: async () => fake.host, daemonOff: false, from: 'account' as const };
    const run = await output(() => installThroughDaemon(profile(['b']), deps));
    expect(run.lines).toEqual(['b was removed here; setup does not add it again']);
    expect(fake.host.add).not.toHaveBeenCalled();
    expect(readMarker()).toEqual([]);
    dir.write('setup.profile-installed', '2026-11-01T10:00:00.000Z\n');
    expect(readMarker()).toEqual([]);
    const kept = await output(() => installThroughDaemon(profile(['b']), deps));
    expect(kept.lines).toEqual([expect.stringMatching(/installed here already/)]);
  });
});
