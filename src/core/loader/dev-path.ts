import { statSync, type Stats } from 'node:fs';

const statOf = (dir: string): Stats | null => {
  try {
    return statSync(dir);
  } catch {
    return null;
  }
};

// Whoever can write a dev folder runs code as you; root may own it. No uid (Windows): unchecked.
export const unsafeDevPath = (dir: string, uid: number | undefined): string | null => {
  const stat = uid === undefined ? null : statOf(dir);
  if (stat === null) return null;
  if ((stat.mode & 0o002) !== 0) return `dev path ${dir} is world-writable`;
  if (stat.uid !== uid && stat.uid !== 0) return `dev path ${dir} is owned by uid ${stat.uid}`;
  return null;
};
