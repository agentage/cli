import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { safeJoin } from './path-safety.js';
import type { FileChange, VaultWriteMode } from './types.js';

export type EditMode = VaultWriteMode | 'overwrite';

export interface WriteResult {
  relPath: string;
  bytesWritten: number;
  mode: EditMode;
  change: FileChange;
}

const nanoid = (): string => randomBytes(4).toString('hex');

const pad2 = (n: number): string => String(n).padStart(2, '0');

const formatDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const formatTimeStamp = (d: Date): string =>
  `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;

const formatTimeHeader = (d: Date): string => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export const writeToVault = async (
  vaultPath: string,
  content: string,
  mode: EditMode,
  explicitPath: string | undefined,
  now: Date = new Date()
): Promise<WriteResult> => {
  let relPath: string;
  let payload: string;

  if (mode === 'inbox-dated') {
    relPath = `inbox/${formatDate(now)}-${formatTimeStamp(now)}-${nanoid()}.md`;
    payload = content;
  } else if (mode === 'append-daily') {
    const date = formatDate(now);
    relPath = `daily/${date}.md`;
    const fullPath = safeJoin(vaultPath, relPath);
    const block = `\n## ${formatTimeHeader(now)}\n\n${content}\n`;
    if (existsSync(fullPath)) {
      let existing = await readFile(fullPath, 'utf-8');
      if (!existing.endsWith('\n')) existing += '\n';
      payload = existing + block;
    } else {
      payload = `# ${date}\n${block}`;
    }
  } else if (mode === 'overwrite') {
    if (!explicitPath || explicitPath.length === 0) {
      throw new Error('overwrite mode requires path');
    }
    relPath = explicitPath;
    payload = content;
  } else {
    throw new Error(`unknown mode: ${mode as string}`);
  }

  const fullPath = safeJoin(vaultPath, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, payload, 'utf-8');
  const st = await stat(fullPath);
  return {
    relPath,
    bytesWritten: Buffer.byteLength(payload, 'utf-8'),
    mode,
    change: {
      path: relPath,
      content: payload,
      sha256: sha256(payload),
      size: st.size,
      mtime: st.mtimeMs,
    },
  };
};
