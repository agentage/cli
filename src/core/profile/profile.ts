import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { withFileLock } from '../../lib/fs/file-lock.js';
import { writeJsonAtomic } from '../../lib/fs/json-file.js';
import { profilePath } from '../paths.js';
import {
  parseProfile,
  SCHEMA_VERSION,
  toDocument,
  type Profile,
  type ProfileParse,
} from './schema.js';

// No extension is published yet, so a machine without a profile starts with none.
export const defaultProfile = (): Profile => ({
  version: SCHEMA_VERSION,
  extensions: {},
  registries: {},
  config: {},
  machines: {},
  extra: {},
});

export const parseProfileText = (raw: string): ProfileParse => {
  try {
    return parseProfile(JSON.parse(raw));
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
};

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

// null only when profile.json is absent; an unreadable or invalid file reports its errors.
export const readProfile = (): ProfileParse | null => {
  let raw: string | null;
  try {
    raw = readText(profilePath());
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
  return raw === null ? null : parseProfileText(raw);
};

// Re-read under the lock: `fn` sees the newest local copy (null when absent or invalid).
export const mutateProfile = async (fn: (current: Profile | null) => Profile): Promise<Profile> => {
  const path = profilePath();
  return withFileLock(path, () => {
    const current = readProfile();
    const next = fn(current?.ok ? current.profile : null);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeJsonAtomic(path, toDocument(next));
    return next;
  });
};
