// The name for the file that preserves the remote side of a conflict: `x.md` -> `x.conflict.md`.
// An existing name is never clobbered - a numeric suffix is added instead (`x.conflict-1.md`).
export const conflictName = (path: string, exists: (candidate: string) => boolean): string => {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const hasExt = dot > slash + 1; // a dot inside the basename, not a leading dot
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  const base = `${stem}.conflict${ext}`;
  if (!exists(base)) return base;
  let i = 1;
  while (exists(`${stem}.conflict-${i}${ext}`)) i += 1;
  return `${stem}.conflict-${i}${ext}`;
};
