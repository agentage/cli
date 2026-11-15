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

// The kit's capability list (from the minor after 0.13); 0.13 has none.
const kitHas = async (name: string, tool: LoadKitTool): Promise<boolean> => {
  const caps = ((await tool()) as { capabilities?: unknown }).capabilities;
  return Array.isArray(caps) && caps.includes(name);
};

// 0.13 ignores `container`.
export const kitBuildsContainer = (tool: LoadKitTool = loadKitTool): Promise<boolean> =>
  kitHas('container', tool);

// The daemon takes `enabled: false` on POST /host/extensions; 0.13 refuses that body (400).
export const kitInstallsDisabled = (tool: LoadKitTool = loadKitTool): Promise<boolean> =>
  kitHas('installDisabled', tool);
