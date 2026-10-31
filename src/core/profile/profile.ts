import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { withFileLock } from '../../lib/fs/file-lock.js';
import { writeJsonAtomic } from '../../lib/fs/json-file.js';
import { profilePath } from '../paths.js';
import { parseProfile, toDocument, type Profile, type ProfileParse } from './schema.js';

export interface ProfileDeps {
  path: () => string;
  readText: (path: string) => string | null;
}

export interface ProfileWriteDeps extends ProfileDeps {
  write: (path: string, doc: Record<string, unknown>) => void;
  lock: <T>(path: string, fn: () => T) => Promise<T>;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

const defaultDeps: ProfileDeps = { path: profilePath, readText };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const parseText = (raw: string): ProfileParse => {
  try {
    return parseProfile(JSON.parse(raw));
  } catch {
    return { ok: false, errors: ['profile.json: not valid JSON'] };
  }
};

// null only when profile.json is absent; an unreadable or invalid file reports its errors.
export const readProfile = (deps: ProfileDeps = defaultDeps): ProfileParse | null => {
  let raw: string | null;
  try {
    raw = deps.readText(deps.path());
  } catch (err) {
    return { ok: false, errors: [`profile.json: ${messageOf(err)}`] };
  }
  return raw === null ? null : parseText(raw);
};

const writeDeps: ProfileWriteDeps = {
  ...defaultDeps,
  write: (path, doc) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeJsonAtomic(path, doc);
  },
  lock: (path, fn) => withFileLock(path, fn),
};

// Re-read under the lock: `fn` sees the newest local copy (null when absent or invalid).
export const mutateProfile = async (
  fn: (current: Profile | null) => Profile,
  deps: ProfileWriteDeps = writeDeps
): Promise<Profile> => {
  const path = deps.path();
  return deps.lock(path, () => {
    const current = readProfile(deps);
    const next = fn(current?.ok ? current.profile : null);
    deps.write(path, toDocument(next));
    return next;
  });
};
