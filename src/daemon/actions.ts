import { createRegistry, shell, type ActionRegistry } from '@agentage/core';
import { VERSION } from '../utils/version.js';
import { getVaultRegistry, persistVaults } from '../vaults/instance.js';
import { createAgentInstallAction } from './actions/agent-install.js';
import { createCliUpdateAction } from './actions/cli-update.js';
import { createProjectAddFromOriginAction } from './actions/project-add-from-origin.js';
import { createVaultAddAction } from './actions/vault-add.js';
import { createVaultListAction } from './actions/vault-list.js';
import { createVaultReindexAction } from './actions/vault-reindex.js';
import { createVaultRemoveAction } from './actions/vault-remove.js';
import type { ShellExec } from './actions/types.js';

const shellExec: ShellExec = (command, options) => shell(command, options);

const readCliVersion = async (): Promise<string> => VERSION;

let registrySingleton: ActionRegistry | null = null;

export const getActionRegistry = (): ActionRegistry => {
  if (registrySingleton) return registrySingleton;

  const registry = createRegistry();
  registry.register(
    createCliUpdateAction({ shell: shellExec, readCurrentVersion: readCliVersion })
  );
  registry.register(createProjectAddFromOriginAction({ shell: shellExec }));
  registry.register(createAgentInstallAction({ shell: shellExec }));

  const vaults = getVaultRegistry();
  const persist = (): void => persistVaults(vaults);
  registry.register(createVaultAddAction({ vaults, persist }));
  registry.register(createVaultRemoveAction({ vaults, persist }));
  registry.register(createVaultReindexAction({ vaults }));
  registry.register(createVaultListAction({ vaults }));

  registrySingleton = registry;
  return registry;
};

export const resetActionRegistry = (): void => {
  registrySingleton = null;
};
