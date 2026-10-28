import { type MachineFile } from './machine.js';
import { type ConfigMap, type Profile } from './schema.js';

export interface Effective {
  // Shared `plugins` map: the same on every machine, so one lock serves them all.
  install: Record<string, string>;
  load: string[];
  off: string[];
  dev: Record<string, string>;
  config: ConfigMap;
}

// Machine values replace shared ones per key; no deep merge, so arrays are replaced whole.
export const mergeConfig = (shared: ConfigMap, local: ConfigMap): ConfigMap => {
  const ids = [...new Set([...Object.keys(shared), ...Object.keys(local)])].sort();
  return Object.fromEntries(ids.map((id) => [id, { ...shared[id], ...local[id] }]));
};

export const effective = (profile: Profile | null, machine: MachineFile): Effective => {
  const install = { ...profile?.plugins };
  const self = profile?.machines[machine.id];
  const off = self?.off ?? [];
  const kept = Object.keys(install).filter((name) => !off.includes(name));
  const load = [...new Set([...kept, ...Object.keys(machine.dev)])].sort();
  const config = mergeConfig(profile?.config ?? {}, self?.config ?? {});
  return { install, load, off, dev: { ...machine.dev }, config };
};
