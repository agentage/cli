import { realpathSync } from 'node:fs';
import { existingOf, type Existing } from '../../lib/daemon/daemon-answer.js';
import { type HostClient, type HostRow, type HostSummary } from '../../lib/daemon/host-client.js';
import { CliError, DaemonError } from '../../lib/json-output.js';

export interface IdBody {
  id: string;
  version?: string;
  enabled?: false;
}
export type AddBody = IdBody | { source: string; enabled?: false };

// The row the daemon has; `already`: the add met an installed id (the daemon's CONFLICT).
export interface Installed {
  row: HostSummary | HostRow;
  already: boolean;
}

// The add is the check: of two cli runs, the second gets CONFLICT naming the installed entry.
const added = (host: HostClient, body: AddBody): Promise<HostSummary | Existing> =>
  host.add(body).catch((err: unknown) => {
    const existing = err instanceof DaemonError ? existingOf(err) : null;
    if (existing) return existing;
    throw err;
  });

const isExisting = (got: HostSummary | Existing): got is Existing => !('state' in got);

const elsewhere = (what: string, id: string): CliError =>
  new CliError('already_installed', `${what}; agentage extension remove ${id} first`);

// The row of an id: added now, or the one the daemon has (removed in between: added again).
export const addOnce = async (host: HostClient, spec: IdBody): Promise<Installed> => {
  const got = await added(host, spec);
  if (!isExisting(got)) return { row: got, already: false };
  const row = (await host.list()).find((r) => r.id === spec.id);
  return row ? { row, already: true } : { row: await host.add(spec), already: false };
};

// An id installed already: another version is a change of version (go back, data kept).
export const installId = async (host: HostClient, spec: IdBody): Promise<Installed> => {
  const got = await addOnce(host, spec);
  if (!got.already) return got;
  const { id, source } = got.row as HostRow;
  if (source !== 'market') throw elsewhere(`${id} runs from the folder ${source}`, id);
  if (spec.version && spec.version !== got.row.version)
    return { row: await host.change(id, { version: spec.version }), already: false };
  return got;
};

export const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// The daemon's row of id when it runs this folder (by real path), else undefined.
export const folderRow = async (host: HostClient, id: string, dir: string) =>
  (await host.list()).find((row) => row.id === id && real(row.source) === real(dir));

// The same folder again (by real path) is installed already; its id from elsewhere is refused.
export const installFolder = async (host: HostClient, source: string): Promise<Installed> => {
  const got = await added(host, { source });
  if (!isExisting(got)) return { row: got, already: false };
  const { id } = got;
  const where = got.source ? `the folder ${got.source}` : 'the market';
  if (!got.source || real(got.source) !== real(source))
    throw elsewhere(`${id} is installed from ${where}`, id);
  const row = (await host.list()).find((r) => r.id === id);
  if (row) return { row, already: true };
  return { row: await host.add({ source }), already: false };
};
