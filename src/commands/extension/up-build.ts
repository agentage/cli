import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { getConfigDir } from '../../lib/fs/config.js';
import { buildScriptOf, type Npm } from './package-build.js';

// D13 revised: the folder's own tsc watches when the build script starts with plain tsc; else
// the whole build script runs in a staging copy. `rest`: the script after the tsc step (the widget bundle).
export type UpMode =
  | { kind: 'tsc'; tsc: string; config: string; rest: string | null }
  | { kind: 'stage'; script: string | null };

// The live tree the daemon runs is dist; the watcher writes only dist.next (the daemon copies it).
export const NEXT = 'dist.next';
const TSC = /^tsc(?:\s+-p\s+(\S+))?$/;

// The folder's own typescript, run as `node typescript/bin/tsc` (no .bin shim, none on Windows).
const tscOf = (dir: string): string | null => {
  try {
    return createRequire(join(dir, 'package.json')).resolve('typescript/bin/tsc');
  } catch {
    return null;
  }
};

export const upModeOf = (dir: string): UpMode => {
  const script = buildScriptOf(dir);
  const [head = '', ...tail] = (script ?? '').split('&&');
  const match = TSC.exec(head.trim());
  const tsc = match ? tscOf(dir) : null;
  if (!match || !tsc) return { kind: 'stage', script };
  const rest = tail.join('&&').trim();
  return { kind: 'tsc', tsc, config: match[1] ?? 'tsconfig.json', rest: rest || null };
};

// dist.next starts as dist, so what tsc does not write (the manifest, dist/ui) stays in it.
export const seedNext = (dir: string): void => {
  mkdirSync(join(dir, NEXT), { recursive: true });
  if (existsSync(join(dir, 'dist')))
    cpSync(join(dir, 'dist'), join(dir, NEXT), { recursive: true, force: true });
};

// The stage is the config folder's cache, one per working copy: never inside the folder.
export const stageOf = (dir: string): string => {
  const hash = createHash('sha256').update(resolve(dir)).digest('hex').slice(0, 12);
  return join(getConfigDir(), 'cache', 'up-stage', `${basename(resolve(dir))}-${hash}`);
};

const NOT_STAGED = new Set(['node_modules', '.agentage', '.git', 'coverage']);
const staged = (name: string): boolean =>
  !NOT_STAGED.has(name) && !name.startsWith('dist') && !name.startsWith('.env');

// The link goes first, so the remove never walks into the folder's own node_modules.
export const removeStage = (dir: string): void => {
  const modules = join(stageOf(dir), 'node_modules');
  if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(modules);
  rmSync(stageOf(dir), { recursive: true, force: true });
};

// A copy of the folder with its node_modules linked: the build there never touches the live dist.
// No .env*, coverage, .git or dist*; a `../` path in the build script resolves from the cache.
export const prepareStage = (dir: string): string => {
  const stage = stageOf(dir);
  removeStage(dir);
  mkdirSync(stage, { recursive: true });
  for (const name of readdirSync(dir).filter(staged))
    cpSync(join(dir, name), join(stage, name), { recursive: true });
  const modules = join(dir, 'node_modules');
  if (existsSync(modules)) symlinkSync(modules, join(stage, 'node_modules'), 'junction');
  return stage;
};

// One build of the current src/ in the stage; its dist goes over dist.next (never the live dist).
export const stagedBuild = async (dir: string, npm: Npm): Promise<void> => {
  const stage = existsSync(stageOf(dir)) ? stageOf(dir) : prepareStage(dir);
  rmSync(join(stage, 'src'), { recursive: true, force: true });
  if (existsSync(join(dir, 'src')))
    cpSync(join(dir, 'src'), join(stage, 'src'), { recursive: true });
  rmSync(join(stage, 'dist'), { recursive: true, force: true });
  await npm(stage, ['run', 'build']);
  if (existsSync(join(stage, 'dist')))
    cpSync(join(stage, 'dist'), join(dir, NEXT), { recursive: true, force: true });
};
