import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isRecord } from '../../lib/fs/json-file.js';
import { profileMarkerPath } from './profile-plan.js';

// An entry of the account profile that did not install; `row`: the daemon kept it as failed.
export interface FailedEntry {
  id: string;
  row: boolean;
}

const isFailed = (value: unknown): value is FailedEntry =>
  isRecord(value) && typeof value['id'] === 'string' && typeof value['row'] === 'boolean';

// null: no marker. A marker of cli 0.52 (a time line) or one that is not JSON has nothing to retry.
export const readMarker = (): FailedEntry[] | null => {
  if (!existsSync(profileMarkerPath())) return null;
  try {
    const doc: unknown = JSON.parse(readFileSync(profileMarkerPath(), 'utf8'));
    const failed = isRecord(doc) && Array.isArray(doc['failed']) ? doc['failed'] : [];
    return failed.filter(isFailed);
  } catch {
    return [];
  }
};

export const writeMarker = (failed: FailedEntry[]): void => {
  mkdirSync(dirname(profileMarkerPath()), { recursive: true });
  const doc = { installedAt: new Date().toISOString(), failed };
  writeFileSync(profileMarkerPath(), `${JSON.stringify(doc)}\n`, { mode: 0o600 });
};
