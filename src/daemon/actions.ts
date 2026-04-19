import { createRegistry, shell, type ActionRegistry } from '@agentage/core';
import { VERSION } from '../utils/version.js';
import { createAgentInstallAction } from './actions/agent-install.js';
import { createCliUpdateAction } from './actions/cli-update.js';
import { createProjectAddFromOriginAction } from './actions/project-add-from-origin.js';
import type { ShellExec } from './actions/types.js';

const shellExec: ShellExec = (command, options) => shell(command, options);

const readCliVersion = async (): Promise<string> => VERSION;

let registrySingleton: ActionRegistry | null = null;

/**
 * Build the daemon's action registry with built-in control-plane actions.
 * Reference actions all declare scope='machine' + require explicit capability;
 * the transport layer decides which capabilities to grant per caller.
 */
export const getActionRegistry = (): ActionRegistry => {
  if (registrySingleton) return registrySingleton;

  const registry = createRegistry();
  registry.register(
    createCliUpdateAction({ shell: shellExec, readCurrentVersion: readCliVersion })
  );
  registry.register(createProjectAddFromOriginAction({ shell: shellExec }));
  registry.register(createAgentInstallAction({ shell: shellExec }));

  registrySingleton = registry;
  return registry;
};

/** Test-only: reset between tests. */
export const resetActionRegistry = (): void => {
  registrySingleton = null;
};
