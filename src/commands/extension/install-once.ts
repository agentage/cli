import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
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

// The add itself is the check, so two cli runs cannot both add one id: the second gets CONFLICT.
const added = (host: HostClient, body: AddBody): Promise<HostSummary | DaemonError> =>
  host.add(body).catch((err: unknown) => {
    if (err instanceof DaemonError && err.code === 'CONFLICT') return err;
    throw err;
  });

const elsewhere = (what: string, id: string): CliError =>
  new CliError('already_installed', `${what}; agentage extension remove ${id} first`);

// The row of an id: added now, or the one the daemon has (removed in between: added again).
export const addOnce = async (host: HostClient, spec: IdBody): Promise<Installed> => {
  const got = await added(host, spec);
  if (!(got instanceof DaemonError)) return { row: got, already: false };
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

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// The daemon's CONFLICT carries no id field: the folder's own manifest names it.
const folderId = (source: string): string | null => {
  const pkg = readJson(join(source, 'package.json'), isRecord);
  const id = isRecord(pkg?.['agentage']) ? pkg['agentage']['id'] : undefined;
  return typeof id === 'string' ? id : null;
};

// A folder: the same folder again (by real path) is installed already; its id from elsewhere is
// refused.
export const installFolder = async (host: HostClient, source: string): Promise<Installed> => {
  const got = await added(host, { source });
  if (!(got instanceof DaemonError)) return { row: got, already: false };
  const here = real(source);
  const row = (await host.list()).find((r) => r.source !== 'market' && real(r.source) === here);
  if (row) return { row, already: true };
  const id = folderId(source) ?? '<id>';
  throw elsewhere(`${id} is installed from the market or another folder`, id);
};
