import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type * as Kit from '@agentage/extension/tool';
import { type KitCheck } from '../../core/loader/load.js';

// What the cli uses of the kit's tool library, typed by the kit itself; the logic lives there.
export type KitTool = Pick<
  typeof Kit,
  | 'check'
  | 'checkLines'
  | 'build'
  | 'buildLines'
  | 'runCommand'
  | 'checkCli'
  | 'up'
  | 'down'
  | 'token'
  | 'readManifest'
  | 'writeContracts'
>;

export type LoadKitTool = () => Promise<KitTool>;

// Imported on use, so every other command starts without loading the kit.
export const loadKitTool: LoadKitTool = () => import('@agentage/extension/tool');

// doctor and every load check a kit-shaped extension's command entry through the kit.
export const kitCheck =
  (tool: LoadKitTool = loadKitTool): KitCheck =>
  async (dir) =>
    (await tool()).checkCli(dir);

const kitRoot = (): string =>
  dirname(createRequire(import.meta.url).resolve('@agentage/extension/package.json'));

export const kitVersion = (): string =>
  (JSON.parse(readFileSync(join(kitRoot(), 'package.json'), 'utf8')) as { version: string })
    .version;

// 0.13 ignores an unknown `container` option and builds part images: look for the module instead.
export const kitBuildsContainer = (): boolean =>
  existsSync(join(kitRoot(), 'dist', 'tool', 'container.js'));
