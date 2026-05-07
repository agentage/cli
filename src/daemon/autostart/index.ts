import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darwin } from './darwin.js';
import { linux } from './linux.js';
import { win32 } from './win32.js';
import type { AutostartDeps, AutostartResult, PlatformModule } from './types.js';

export type { AutostartDeps, AutostartResult, PlatformModule } from './types.js';

const realExec = (cmd: string): void => {
  execSync(cmd, { stdio: 'pipe' });
};

const resolveDaemonEntry = (): string => {
  // From dist/daemon/autostart/index.js → dist/daemon-entry.js
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'daemon-entry.js');
};

export const platformModule = (
  platform: NodeJS.Platform = process.platform
): PlatformModule | null => {
  switch (platform) {
    case 'linux':
      return linux;
    case 'darwin':
      return darwin;
    case 'win32':
      return win32;
    default:
      return null;
  }
};

const realDeps = (): AutostartDeps => ({
  homeDir: homedir(),
  nodeBin: process.execPath,
  entryPath: resolveDaemonEntry(),
  exec: realExec,
});

export const installAutostart = (deps: AutostartDeps = realDeps()): AutostartResult | null => {
  const mod = platformModule();
  if (!mod) return null;
  return mod.install(deps);
};

export const uninstallAutostart = (deps: AutostartDeps = realDeps()): void => {
  const mod = platformModule();
  if (mod) mod.uninstall(deps);
};

export const isAutostartInstalled = (deps: AutostartDeps = realDeps()): boolean => {
  const mod = platformModule();
  return mod ? mod.isInstalled(deps) : false;
};
