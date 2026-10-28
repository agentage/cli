import { readFileSync } from 'node:fs';
import { profilePath } from '../paths.js';
import { parseProfile, type ProfileParse } from './schema.js';

export interface ProfileDeps {
  path: () => string;
  readText: (path: string) => string | null;
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
