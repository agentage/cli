import { type KitCheck } from '../../core/loader/load.js';

export interface KitRun {
  dir: string;
  command: string;
  argv: string[];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface KitUp {
  dir?: string;
  onLine?: (line: string) => void;
}

export interface KitDown extends KitUp {
  keepData?: boolean;
}

// What the cli uses of the kit's tool library; the logic lives in the kit.
export interface KitTool {
  runCommand: (options: KitRun) => Promise<number>;
  checkCli: (dir: string) => Promise<string | null>;
  up: (options: KitUp) => Promise<{ parts: number; seconds: number }>;
  down: (options: KitDown) => Promise<unknown>;
  token: (options: { scope: string; issuer?: string }) => Promise<string>;
}

export type LoadKitTool = () => Promise<KitTool>;

// Imported on use, so every other command starts without loading the kit.
export const loadKitTool: LoadKitTool = async () =>
  (await import('@agentage/extension/tool')) as unknown as KitTool;

// doctor and every load check a kit-shaped extension's command entry through the kit.
export const kitCheck =
  (tool: LoadKitTool = loadKitTool): KitCheck =>
  async (dir) =>
    (await tool()).checkCli(dir);
