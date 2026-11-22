export type Row = { id: string; version: string; result: string; err?: unknown };

const messageOf = (r: Row): string => `${r.id}: ${(r.err as Error).message}`;

const table = (rows: Row[]): string[] => {
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const versionWidth = Math.max(7, ...rows.map((r) => r.version.length));
  const line = (id: string, version: string, result: string) =>
    `${id.padEnd(idWidth)}  ${version.padEnd(versionWidth)}  ${result}`;
  return [line('id', 'version', 'result'), ...rows.map((r) => line(r.id, r.version, r.result))];
};

// One table of every extension; any failure makes one non-zero exit after all were tried.
export const summary = (rows: Row[]): void => {
  if (rows.length === 0) return;
  for (const line of table(rows)) console.log(line);
  const failed = rows.filter((r) => r.err !== undefined);
  const first = failed[0]?.err as Error | undefined;
  if (!first) return;
  // The first error keeps its code; its message names every failed extension.
  first.message = failed.map(messageOf).join('\n');
  throw first;
};

// Rows of extensions that get no version this run: refused (with its error) or unchanged.
export const rowsOf = (folders: { id: string; err?: unknown }[], result: string): Row[] =>
  folders.map((f) => ({ id: f.id, version: '-', result, err: f.err }));
