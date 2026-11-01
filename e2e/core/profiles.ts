/**
 * Profile documents an e2e/core test writes: short fixture names expanded, `@agentage` sent to
 * the test's loopback registry, this machine's `off` list keyed by its machine.json id.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ConfigFiles } from './files.js';

// Extensions by short fixture name (`hello` for `@agentage/fixture-hello`) or full package name.
export interface ProfileSpec {
  extensions: Record<string, string>;
  // Turned off on this machine; machine.json is written first when absent.
  off?: string[];
  // Added to `@agentage` -> the loopback registry.
  registries?: Record<string, string>;
  // The shared `config`, by extension id.
  config?: Record<string, Record<string, unknown>>;
}

// `hello` -> `@agentage/fixture-hello`; a scoped name stays as written.
const pkg = (name: string): string => (name.startsWith('@') ? name : `@agentage/fixture-${name}`);

export const expand = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).map(([name, value]) => [pkg(name), value]));

const E2E_MACHINE = {
  id: 'm_0000beef',
  name: 'e2e-box',
  dev: {},
  profileSource: 'default',
  accountId: null,
  profileEtag: null,
};

// A profile document: `@agentage` from the loopback registry, short names expanded.
export const profileDoc = (registry: string, files: ConfigFiles) => {
  const machineId = (): string => {
    if (!files.exists('machine.json')) files.write('machine.json', E2E_MACHINE);
    return String(files.json('machine.json')['id']);
  };
  return ({ extensions, off, registries, config = {} }: ProfileSpec) => ({
    version: 1,
    extensions: expand(extensions),
    registries: { '@agentage': registry, ...registries },
    config,
    machines: off ? { [machineId()]: { off: off.map(pkg) } } : {},
  });
};

// Profile files sit beside the machine, outside its config dir and HOME.
export const profileWriter = (scratch: string, docOf: ReturnType<typeof profileDoc>) => {
  let count = 0;
  return (spec: ProfileSpec): string => {
    const path = join(scratch, `profile-${++count}.json`);
    writeFileSync(path, JSON.stringify(docOf(spec), null, 2));
    return path;
  };
};
