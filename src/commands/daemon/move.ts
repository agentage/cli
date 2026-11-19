import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as AppHost from '@agentage/apphost';
import { settingsPath } from '../../core/loader/installed.js';
import { ensureConfigDir, getConfigDir } from '../../lib/fs/config.js';
import { isRecord, readJson, writeJsonAtomic } from '../../lib/fs/json-file.js';
import { messageOf } from '../../lib/json-output.js';
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

// The app host's own writer and lock, the daemon's path: a daemon already serving may write at the same time.
export type KitMove = Pick<typeof AppHost, 'updateInstallation' | 'withFileLock'>;
const kitMove = (): Promise<KitMove> => import('@agentage/apphost');

// An id in installation.json keeps its row: a rerun after a stop adds only what is missing.
const addRow = (kit: KitMove, row: Row): Promise<unknown> =>
  kit.updateInstallation(getConfigDir(), (doc) =>
    doc.extensions.some((r) => r.id === row.id)
      ? doc
      : { ...doc, extensions: [...doc.extensions, row as AppHost.InstallEntry] }
  );

// The daemon's own values win over the profile's: they were set after the move.
const addSettings = async (
  kit: KitMove,
  id: string,
  settings: Record<string, unknown>
): Promise<void> => {
  if (Object.keys(settings).length === 0) return;
  await kit.withFileLock(settingsPath(), () => {
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
  kit?: () => Promise<KitMove>;
}

// A row the kit's check refuses is skipped with its reason; the other rows still move.
const addEntry = async (kit: KitMove, moved: Moved, hooks: MoveHooks): Promise<Skipped | null> => {
  try {
    await addRow(kit, moved.row);
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'VALIDATION_ERROR') throw err;
    return { entry: moved.row.id, reason: `the daemon refuses the row (${messageOf(err)})` };
  }
  await addSettings(kit, moved.row.id, moved.settings);
  hooks.entry?.(moved);
  return null;
};

const addAll = async (kit: KitMove, report: MoveReport, plan: Moved[], hooks: MoveHooks) => {
  for (const moved of plan) {
    const skipped = await addEntry(kit, moved, hooks);
    if (!skipped) continue;
    report.skipped.push(skipped);
    report.moved = report.moved.filter((id) => id !== skipped.entry);
  }
};

// D6, before the daemon reads the file. An old list that does not parse moves nothing and writes
// no marker: the daemon still starts, and the next start tries again.
export const moveOldLists = async (hooks: MoveHooks = {}): Promise<void> => {
  const marker = join(ensureConfigDir(), MOVED_MARKER);
  if (existsSync(marker)) return;
  const plan = movePlan();
  const report: MoveReport = {
    moved: plan.moved.map((m) => m.row.id),
    skipped: [...plan.skipped],
    warning: plan.warning,
  };
  if (plan.warning) {
    writeReport(report);
    return console.error(`move: ${plan.warning}; nothing moved, fix it and restart the daemon`);
  }
  const kit = await (hooks.kit ?? kitMove)();
  await addAll(kit, report, plan.moved, hooks);
  writeReport(report);
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  say(report);
};

// The daemon's `before`: a move that fails (a held lock, a full disk) never stops the start. No
// marker is written, so the next start tries again; `daemon status` shows the reason. Another live
// daemon on the folder is no move failure: this start ends, and that daemon's report stays.
export const moveBeforeStart = async (hooks: MoveHooks = {}): Promise<void> => {
  try {
    await moveOldLists(hooks);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'DAEMON_RUNNING') throw err;
    const warning = `the move stopped (${messageOf(err)}); the next daemon start tries again`;
    console.error(`move: ${warning}`);
    try {
      writeReport({ moved: [], skipped: [], warning });
    } catch {
      // the report is only shown; the daemon still starts
    }
  }
};
