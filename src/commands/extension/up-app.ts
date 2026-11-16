import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppBuilder } from '@agentage/extension/tool';
import { isRecord } from '../../lib/fs/json-file.js';
import { messageOf } from '../../lib/json-output.js';
import { loadKitTool, type LoadKitTool } from './kit-tool.js';
import { packageOf } from './package-build.js';
import { NEXT } from './up-build.js';
import { type Run } from './up-reload.js';

// The app part's build output (kit APP_DIR); the shell imports it, the child never reads it.
export const APP_OUT = join('dist', 'app');

export const hasAppPart = (dir: string): boolean => {
  const agentage = packageOf(dir)['agentage'];
  const parts = isRecord(agentage) ? agentage['parts'] : undefined;
  return isRecord(parts) && parts['app'] === true;
};

// A warm esbuild context for the whole up; null (with one line) when it cannot start.
export const startAppBuilder = async (
  dir: string,
  tool: LoadKitTool = loadKitTool
): Promise<AppBuilder | null> => {
  if (!hasAppPart(dir)) return null;
  try {
    return await (await tool()).appBuilder(dir);
  } catch (err) {
    console.error(`app       no app build: ${messageOf(err)}`);
    return null;
  }
};

// A full reload swaps dist.next for dist whole: dist.next/app must be the current app build.
export const appIntoNext = (dir: string): void => {
  const next = join(dir, NEXT, 'app');
  rmSync(next, { recursive: true, force: true });
  if (existsSync(join(dir, APP_OUT))) cpSync(join(dir, APP_OUT), next, { recursive: true });
};

// One build of src/app into dist/app and dist.next/app; false (one line) when it failed.
export const buildAppOnce = async (dir: string, builder: AppBuilder): Promise<boolean> => {
  try {
    await builder.rebuild();
  } catch (err) {
    console.error(`app       build failed, no reload: ${messageOf(err)}`);
    return false;
  }
  appIntoNext(dir);
  return true;
};

// A save in src/app: build it, then a reload of the app part only (the child keeps running).
export const appAndReload = async (run: Run, builder: AppBuilder): Promise<void> => {
  const since = Date.now();
  if (!(await buildAppOnce(run.dir, builder))) return;
  const answer = await run.host
    .reload(run.id, 'app')
    .catch((err: unknown) => ({ error: messageOf(err) }));
  const ms = Date.now() - since;
  if ('error' in answer) return console.error(`app       ${run.id} reload failed: ${answer.error}`);
  console.log(`app       ${run.id} reloaded in ${ms} ms (the child keeps running)`);
};
