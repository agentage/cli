import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolveEdit, type EditOp } from './memory-edit.js';
import { safeJoin } from './path-safety.js';

// Markdown CRUD over a vault directory. The file is canonical; the SQLite index is derived.
// Frontmatter is a leading `---` YAML block (parsed/emitted with the `yaml` dep).

export interface DocView {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  tags: string[];
  updated: string;
  size: number;
}

export interface WriteReceipt {
  path: string;
  bytesWritten: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const parseDoc = (raw: string): { frontmatter: Record<string, unknown>; body: string } => {
  const m = FRONTMATTER.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(m[1]!);
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
  } catch {
    // a malformed frontmatter block is treated as body, not a hard error
    return { frontmatter: {}, body: raw };
  }
  return { frontmatter, body: raw.slice(m[0].length) };
};

const composeDoc = (body: string, frontmatter?: Record<string, unknown>): string =>
  frontmatter && Object.keys(frontmatter).length > 0
    ? `---\n${stringifyYaml(frontmatter)}---\n${body}`
    : body;

const titleOf = (relPath: string, fm: Record<string, unknown>, body: string): string => {
  if (typeof fm['title'] === 'string' && fm['title'].length > 0) return fm['title'];
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading ? heading[1]!.trim() : basename(relPath).replace(/\.md$/i, '');
};

const tagsOf = (fm: Record<string, unknown>): string[] =>
  Array.isArray(fm['tags']) ? fm['tags'].filter((t): t is string => typeof t === 'string') : [];

export const docExists = (vaultPath: string, relPath: string): boolean =>
  existsSync(safeJoin(vaultPath, relPath));

export const readDoc = async (vaultPath: string, relPath: string): Promise<DocView> => {
  const full = safeJoin(vaultPath, relPath);
  if (!existsSync(full)) throw new Error(`not found: ${relPath}`);
  const raw = await readFile(full, 'utf-8');
  const st = await stat(full);
  const { frontmatter, body } = parseDoc(raw);
  return {
    path: relPath,
    title: titleOf(relPath, frontmatter, body),
    frontmatter,
    body,
    tags: tagsOf(frontmatter),
    updated: new Date(st.mtimeMs).toISOString(),
    size: st.size,
  };
};

export const writeDoc = async (
  vaultPath: string,
  relPath: string,
  body: string,
  frontmatter?: Record<string, unknown>
): Promise<WriteReceipt> => {
  const full = safeJoin(vaultPath, relPath);
  const payload = composeDoc(body, frontmatter);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, payload, 'utf-8');
  return { path: relPath, bytesWritten: Buffer.byteLength(payload, 'utf-8') };
};

export const editDoc = async (vaultPath: string, op: EditOp): Promise<WriteReceipt> => {
  const current = await readDoc(vaultPath, op.path);
  const nextBody = resolveEdit(current.body, op);
  return writeDoc(vaultPath, op.path, nextBody, current.frontmatter);
};

// Soft delete: move the file into the vault's `.trash/` (dot-prefixed, so the scanner skips
// it), preserving its relative path. Recoverable; the index drops it on the next reconcile.
export const deleteDoc = async (
  vaultPath: string,
  relPath: string
): Promise<{ path: string; trashedTo: string }> => {
  const full = safeJoin(vaultPath, relPath);
  if (!existsSync(full)) throw new Error(`not found: ${relPath}`);
  const trashRel = `.trash/${relPath}`;
  const trashFull = safeJoin(vaultPath, trashRel);
  await mkdir(dirname(trashFull), { recursive: true });
  await rename(full, trashFull);
  return { path: relPath, trashedTo: trashRel };
};
