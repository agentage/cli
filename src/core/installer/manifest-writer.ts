// A fixed name keeps the lock's root entry identical in every tree directory.
export const MANIFEST_NAME = 'agentage-plugins';

export const sortedSet = (install: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(install).sort(([a], [b]) => (a < b ? -1 : 1)));

// Same install set, same bytes: no scripts, nothing machine-specific.
export const manifestText = (install: Record<string, string>): string =>
  `${JSON.stringify(
    { name: MANIFEST_NAME, private: true, dependencies: sortedSet(install) },
    null,
    2
  )}\n`;
