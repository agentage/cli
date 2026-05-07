import type { AutostartDeps, AutostartResult, PlatformModule } from './types.js';

export const TASK_NAME = 'AgentageDaemon';

const buildCreateCommand = (nodeBin: string, entryPath: string): string => {
  // /TR receives a single string. Inner double-quotes around each path
  // (so spaces work) must be escaped with backslash for cmd.exe.
  const tr = `\\"${nodeBin}\\" \\"${entryPath}\\"`;
  return `schtasks /Create /TN "${TASK_NAME}" /SC ONLOGON /RL LIMITED /TR "${tr}" /F`;
};

export const win32: PlatformModule = {
  install(deps: AutostartDeps): AutostartResult {
    deps.exec(buildCreateCommand(deps.nodeBin, deps.entryPath));
    return { mechanism: 'schtasks-onlogon', unitPath: TASK_NAME, startsAtBoot: false };
  },

  uninstall(deps: AutostartDeps): void {
    try {
      deps.exec(`schtasks /Delete /TN "${TASK_NAME}" /F`);
    } catch {
      // Task may already be gone.
    }
  },

  isInstalled(deps: AutostartDeps): boolean {
    try {
      deps.exec(`schtasks /Query /TN "${TASK_NAME}"`);
      return true;
    } catch {
      return false;
    }
  },
};

export { buildCreateCommand };
