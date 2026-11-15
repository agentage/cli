import { vi } from 'vitest';
import { DaemonError } from '../lib/json-output.js';
import { type HostClient, type HostRow } from '../lib/daemon/host-client.js';

// A daemon in memory for the lifecycle commands: the rows it holds and what was asked of it.
export const fakeHost = (rows: HostRow[] = []) => {
  const row = (id: string): HostRow => {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new DaemonError('NOT_FOUND', `${id} is not installed`);
    return found;
  };
  const host: HostClient = {
    list: vi.fn(async () => rows.map((r) => ({ ...r }))),
    add: vi.fn(async (body) => {
      const id = 'id' in body ? body.id : 'demo';
      if (rows.some((r) => r.id === id)) throw new DaemonError('CONFLICT', `${id} is installed`);
      const added: HostRow = {
        id,
        version: '0.7.0',
        source: 'market',
        state: 'running',
        enabled: true,
      };
      if ('source' in body) Object.assign(added, { version: '0.1.0', source: body.source });
      if ('version' in body && body.version) added.version = body.version;
      rows.push(added);
      return added;
    }),
    change: vi.fn(async (id, patch) => {
      const r = row(id);
      if (patch.version) r.version = patch.version;
      if (patch.enabled !== undefined) r.state = patch.enabled ? 'running' : 'disabled';
      return r;
    }),
    remove: vi.fn(async (id) => {
      row(id);
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1
      );
      return { id };
    }),
  };
  return { host, rows, deps: { host: async () => host } };
};

export const marketRow = (id: string, version: string): HostRow => ({
  id,
  version,
  source: 'market',
  state: 'running',
  enabled: true,
});
