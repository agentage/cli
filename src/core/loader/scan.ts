import { currentDependencies, lockDrift, planChanges, type Plan } from '../installer/plan.js';
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
  // The profile against the current tree, by package.
  plan: Plan;
  // In the current tree, no longer in the profile: listed until setup removes them, never loaded.
  removed: DiscoveredExtension[];
  // name@version whose integrity the two locks disagree on.
  drift: string[];
}

// A tree extension whose bytes the two locks disagree on is never trusted, so never imported.
const withDrift = (found: Discovery, drift: string[]): Discovery => ({
  ...found,
  extensions: found.extensions.map((p) => {
    const key = `${p.pkg}@${p.version}`;
    const drifted = p.source === 'tree' && p.problem === null && drift.includes(key);
    return drifted ? { ...p, problem: `integrity drift: ${key}` } : p;
  }),
});

// Everything known about this machine's extensions without running any of them.
export const scan = (machine: MachineFile): Scan => {
  const parsed = readProfile();
  const eff = effective(parsed?.ok ? parsed.profile : null, machine);
  const dir = extensionsDir();
  const drift = lockDrift(dir).integrity;
  const input = { extensionsDir: dir, dev: eff.dev, config: eff.config };
  const found = withDrift(discover({ ...input, names: Object.keys(eff.install) }), drift);
  const plan = planChanges(eff, currentDependencies(dir));
  const gone = plan.extensions.filter((e) => e.verb === 'remove' && !(e.name in eff.dev));
  const removed = discover({ ...input, dev: {}, names: gone.map((e) => e.name) }).extensions;
  const states = staticStates(found.extensions, eff.off);
  return { machine, parsed, eff, found, states, plan, removed, drift };
};

// What can load: a valid manifest, installed, not off here, and peers that can load too.
export const loadSet = (found: Scan): DiscoveredExtension[] =>
  found.found.extensions.filter((ext) => found.states.get(ext.pkg)?.state === 'installed');
