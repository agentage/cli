import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Npm } from './package-build.js';

// D13 revised: the folder's own tsc watches when the build script starts with plain tsc; else
// the whole build script runs in a staging copy. `rest`: the script after the tsc step (the widget bundle).
export type UpMode =
  | { kind: 'tsc'; tsc: string; config: string; rest: string | null }
  | { kind: 'stage'; script: string | null };

// The live tree the daemon runs is dist; the watcher writes only dist.next (the daemon copies it).
export const NEXT = 'dist.next';
const TSC = /^tsc(?:\s+-p\s+(\S+))?$/;

export const buildScriptOf = (dir: string): string | null => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  const script = pkg.scripts?.['build'];
  return typeof script === 'string' ? script : null;
};

export const upModeOf = (dir: string): UpMode => {
  const script = buildScriptOf(dir);
  const [head = '', ...tail] = (script ?? '').split('&&');
  const match = TSC.exec(head.trim());
  const tsc = join(dir, 'node_modules', '.bin', 'tsc');
  if (!match || !existsSync(tsc)) return { kind: 'stage', script };
  const rest = tail.join('&&').trim();
  return { kind: 'tsc', tsc, config: match[1] ?? 'tsconfig.json', rest: rest || null };
};

// dist.next starts as dist, so what tsc does not write (the manifest, dist/ui) stays in it.
export const seedNext = (dir: string): void => {
  mkdirSync(join(dir, NEXT), { recursive: true });
  if (existsSync(join(dir, 'dist')))
    cpSync(join(dir, 'dist'), join(dir, NEXT), { recursive: true, force: true });
};

export const stageOf = (dir: string): string => join(dir, '.agentage', 'stage');
const NOT_STAGED = new Set(['node_modules', 'dist', NEXT, 'dist.prev', '.agentage', '.git']);

// A copy of the folder with its node_modules linked: the build there never touches the live dist.
export const prepareStage = (dir: string): string => {
  const stage = stageOf(dir);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const name of readdirSync(dir).filter((n) => !NOT_STAGED.has(n)))
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
