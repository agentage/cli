import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installationPath } from '../../core/loader/installed.js';
import { scan } from '../../core/loader/scan.js';
import { NO_MACHINE, readMachine } from '../../core/profile/machine.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { ensureConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';

// Written once the old lists are in installation.json; the old files themselves stay as they were.
export const MOVED_MARKER = 'installation.moved';

type Row = Record<string, unknown> & { id: string };

const PACKAGE_ID = /^(?:@agentage\/extension-|agentage-extension-)([a-z][a-z0-9-]*)$/;

// One old entry as a C3 row: a dev folder as source, an off package as enabled false.
const rowOf = (ext: DiscoveredExtension, spec: string | undefined, off: boolean): Row | null => {
  const id = ext.id ?? PACKAGE_ID.exec(ext.pkg)?.[1];
  if (!id) return null;
  if (ext.source === 'dev') return { id, source: ext.dir };
  const version = ext.version ?? spec?.replace(/^[\^~]/, '');
  return version ? { id, version, ...(off && { enabled: false }) } : null;
};

// profile.json extensions{} and off, machine.json dev{}: what cli 0.51 ran on this machine.
export const oldRows = (): Row[] => {
  const found = scan(readMachine() ?? NO_MACHINE);
  const { install, off } = found.eff;
  const rows = found.found.extensions.map((ext) =>
    rowOf(ext, install[ext.pkg], off.includes(ext.pkg))
  );
  return rows.filter((row): row is Row => row !== null);
};

const merged = (rows: Row[]) => {
  const doc = readJson(installationPath(), isRecord) ?? { host: 'local' };
  const have = Array.isArray(doc['extensions']) ? (doc['extensions'] as Row[]) : [];
  const ids = new Set(have.map((row) => row.id));
  return { ...doc, extensions: [...have, ...rows.filter((row) => !ids.has(row.id))] };
};

// D6, before the daemon reads the file: each run adds only the ids it lacks, so a stop half way
// loses nothing and the next start finishes it.
export const moveOldLists = async (): Promise<void> => {
  const marker = join(ensureConfigDir(), MOVED_MARKER);
  if (existsSync(marker)) return;
  const rows = oldRows();
  if (rows.length > 0) writeJsonAtomic(installationPath(), merged(rows), 0o644);
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  if (rows.length > 0) console.error(`moved ${rows.length} extensions into installation.json`);
};
