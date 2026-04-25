import { getVaultStorageDir, loadConfig, saveConfig } from '../daemon/config.js';
import { VaultRegistry } from './registry.js';

let registrySingleton: VaultRegistry | null = null;

export const getVaultRegistry = (): VaultRegistry => {
  if (registrySingleton) return registrySingleton;
  const config = loadConfig();
  registrySingleton = new VaultRegistry({ storageDir: getVaultStorageDir() });
  registrySingleton.hydrate(config.vaults ?? {});
  return registrySingleton;
};

export const resetVaultRegistry = (): void => {
  registrySingleton = null;
};

export const persistVaults = (registry: VaultRegistry): void => {
  const config = loadConfig();
  config.vaults = registry.toConfigShape();
  saveConfig(config);
};
