import { type MachineFile } from '../profile/machine.js';
import { effective, type Effective } from '../profile/merge.js';
import { readProfile } from '../profile/profile.js';
import { type ProfileParse } from '../profile/schema.js';
import { extensionsDir } from '../paths.js';
import { discover, type DiscoveredExtension, type Discovery } from './discover.js';
import { staticStates, type StaticResult } from './states.js';

export interface Scan {
  machine: MachineFile;
  parsed: ProfileParse | null;
  eff: Effective;
  found: Discovery;
  states: Map<string, StaticResult>;
}

// Everything known about this machine's extensions without running any of them.
export const scan = (machine: MachineFile): Scan => {
  const parsed = readProfile();
  const eff = effective(parsed?.ok ? parsed.profile : null, machine);
  const found = discover({
    extensionsDir: extensionsDir(),
    names: Object.keys(eff.install),
    dev: eff.dev,
    config: eff.config,
  });
  return { machine, parsed, eff, found, states: staticStates(found.extensions, eff.off) };
};

// What can load: a valid manifest, installed, not off here, and peers that can load too.
export const loadSet = (found: Scan): DiscoveredExtension[] =>
  found.found.extensions.filter((ext) => found.states.get(ext.pkg)?.state === 'installed');
