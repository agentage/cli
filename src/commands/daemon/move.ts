import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installationPath, settingsPath } from '../../core/loader/installed.js';
import { ensureConfigDir, getConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { withKitLock } from '../../lib/fs/kit-lock.js';
import { movePlan, type Moved, type Row, type Skipped } from './move-plan.js';

// Written once every old entry is moved or deliberately skipped; the old files stay as they were.
export const MOVED_MARKER = 'installation.moved';
// What the last move did: the skipped entries and why, or the warning that stopped it.
export const MOVE_REPORT = 'installation.moved.json';

export interface MoveReport {
  moved: string[];
  skipped: Skipped[];
  warning: string | null;
}

// An id in installation.json keeps its row: a rerun after a stop adds only what is missing.
// Under the daemon's own lock: a daemon already serving may write the file at the same time.
const addRow = (row: Row): Promise<void> =>
  withKitLock(installationPath(), () => {
    const doc = readJson(installationPath(), isRecord) ?? { host: 'local' };
    const have = Array.isArray(doc['extensions']) ? (doc['extensions'] as Row[]) : [];
    if (have.some((r) => r.id === row.id)) return;
    writeJsonAtomic(installationPath(), { ...doc, extensions: [...have, row] }, 0o644);
  });

// The daemon's own values win over the profile's: they were set after the move.
const addSettings = async (id: string, settings: Record<string, unknown>): Promise<void> => {
  if (Object.keys(settings).length === 0) return;
  await withKitLock(settingsPath(), () => {
    const all = readJson(settingsPath(), isRecord) ?? {};
    const mine = isRecord(all[id]) ? all[id] : {};
    writeJsonAtomic(settingsPath(), { ...all, [id]: { ...settings, ...mine } }, 0o600);
  });
};

const writeReport = (report: MoveReport): void =>
  writeJsonAtomic(join(getConfigDir(), MOVE_REPORT), report, 0o644);

const isSkipped = (v: unknown): v is Skipped =>
  isRecord(v) && typeof v['entry'] === 'string' && typeof v['reason'] === 'string';

const isMoveReport = (v: unknown): v is MoveReport =>
  isRecord(v) &&
  Array.isArray(v['moved']) &&
  v['moved'].every((id) => typeof id === 'string') &&
  Array.isArray(v['skipped']) &&
  v['skipped'].every(isSkipped) &&
  (v['warning'] === null || typeof v['warning'] === 'string');

export const readMoveReport = (): MoveReport | null =>
  readJson(join(getConfigDir(), MOVE_REPORT), isMoveReport);

const say = (report: MoveReport): void => {
  if (report.moved.length > 0)
    console.error(`moved ${report.moved.length} extensions into installation.json`);
  for (const { entry, reason } of report.skipped) console.error(`move skipped ${entry}: ${reason}`);
};

export interface MoveHooks {
  // Runs after each entry; a test stops the move here to check that a rerun finishes it.
  entry?: (moved: Moved) => void;
}

const addEntry = async (moved: Moved, hooks: MoveHooks): Promise<void> => {
  await addRow(moved.row);
  await addSettings(moved.row.id, moved.settings);
  hooks.entry?.(moved);
};

// D6, before the daemon reads the file. An old list that does not parse moves nothing and writes
// no marker: the daemon still starts, and the next start tries again.
export const moveOldLists = async (hooks: MoveHooks = {}): Promise<void> => {
  const marker = join(ensureConfigDir(), MOVED_MARKER);
  if (existsSync(marker)) return;
  const plan = movePlan();
  const report = {
    moved: plan.moved.map((m) => m.row.id),
    skipped: plan.skipped,
    warning: plan.warning,
  };
  if (plan.warning) {
    writeReport(report);
    return console.error(`move: ${plan.warning}; nothing moved, fix it and restart the daemon`);
  }
  for (const moved of plan.moved) await addEntry(moved, hooks);
  writeReport(report);
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  say(report);
};
