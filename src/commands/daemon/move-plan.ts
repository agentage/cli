import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { installationPath, settingsPath } from '../../core/loader/installed.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type DiscoveredExtension } from '../../core/loader/discover.js';
import { onlyKitRange } from '../../core/loader/manifest.js';
import { scan } from '../../core/loader/scan.js';
import { NO_MACHINE, readMachine } from '../../core/profile/machine.js';
import { machinePath } from '../../core/paths.js';
import { readProfile } from '../../core/profile/profile.js';
import { movedSettings } from './move-settings.js';

export type Row = Record<string, unknown> & { id: string };

// One old entry as it moves: its C3 row and the profile settings of that id.
export interface Moved {
  row: Row;
  settings: Record<string, unknown>;
}

export interface Skipped {
  entry: string;
  reason: string;
}

// warning: an old list that does not parse; nothing moves until it is fixed.
export interface MovePlan {
  moved: Moved[];
  skipped: Skipped[];
  warning: string | null;
}

const PACKAGE_ID = /^(?:@agentage\/extension-|agentage-extension-)([a-z][a-z0-9-]*)$/;

// A file that is there but does not parse would be written over as empty: its rows would be lost.
const unparsed = (path: string): boolean => existsSync(path) && readJson(path, isRecord) === null;

const invalidList = (): string | null => {
  const parsed = readProfile();
  if (parsed !== null && !parsed.ok) return `profile.json is invalid (${parsed.errors.join('; ')})`;
  if (existsSync(machinePath()) && readMachine() === null) return 'machine.json is invalid';
  const bad = [installationPath(), settingsPath()].find(unparsed);
  return bad ? `${basename(bad)} does not parse` : null;
};

// Why an entry stays behind: never run a folder 0.51 refused, or a package that is not there. A
// package built on an older kit moves: the daemon runs it, and a failed start shows in list.
const reasonOf = (ext: DiscoveredExtension, id: string | undefined): string | null => {
  if (ext.missing)
    return ext.source === 'dev' ? 'folder missing' : 'not installed in the 0.51 tree';
  if (!id) return 'no agentage.id';
  if (ext.problem && !onlyKitRange(ext.problem)) return ext.problem;
  return ext.source === 'tree' && !ext.version ? 'no exact version' : null;
};

const entryOf = (ext: DiscoveredExtension, off: boolean): Moved | Skipped => {
  const id = ext.id ?? PACKAGE_ID.exec(ext.pkg)?.[1];
  const reason = reasonOf(ext, id);
  if (reason !== null || !id)
    return { entry: ext.source === 'dev' ? ext.dir : ext.pkg, reason: reason ?? '' };
  const where = ext.source === 'dev' ? { source: ext.dir } : { version: ext.version };
  return { row: { id, ...where, ...(off && { enabled: false }) }, settings: {} };
};

// profile.json extensions{}, off and config, machine.json dev{}: what cli 0.51 ran here.
export const movePlan = (): MovePlan => {
  const warning = invalidList();
  if (warning) return { moved: [], skipped: [], warning };
  const found = scan(readMachine() ?? NO_MACHINE);
  const { off, config } = found.eff;
  const plan: MovePlan = { moved: [], skipped: [], warning: null };
  for (const ext of found.found.extensions) {
    const entry = entryOf(ext, off.includes(ext.pkg));
    if ('reason' in entry) plan.skipped.push(entry);
    else {
      const { settings, dropped } = movedSettings(entry.row.id, ext.dir, {
        ...config[entry.row.id],
      });
      plan.moved.push({ ...entry, settings });
      plan.skipped.push(...dropped);
    }
  }
  return plan;
};
