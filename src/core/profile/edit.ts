import { loadMachine, setProfileSource } from './machine.js';
import { editableProfile, mutateProfile } from './profile.js';
import { type MachineEntry, type Profile } from './schema.js';

const NO_ENTRY: MachineEntry = { off: [], config: {}, extra: {} };

// This machine's off list with `name` in or out; an entry is only created to turn one off.
const withOff = (profile: Profile, machineId: string, name: string, off: boolean): Profile => {
  const self = profile.machines[machineId];
  if (!self && !off) return profile;
  const rest = (self?.off ?? []).filter((pkg) => pkg !== name);
  const entry = { ...NO_ENTRY, ...self, off: off ? [...rest, name] : rest };
  return { ...profile, machines: { ...profile.machines, [machineId]: entry } };
};

// Installing a name again replaces its spec; without --off it loads on this machine again.
export const addExtension = (
  profile: Profile,
  name: string,
  spec: string,
  machineId: string,
  off: boolean
): Profile =>
  withOff(
    { ...profile, extensions: { ...profile.extensions, [name]: spec } },
    machineId,
    name,
    off
  );

// Other machines' off lists are theirs to keep.
export const dropExtension = (profile: Profile, name: string, machineId: string): Profile => {
  const extensions = Object.fromEntries(
    Object.entries(profile.extensions).filter(([pkg]) => pkg !== name)
  );
  return withOff({ ...profile, extensions }, machineId, name, false);
};

// A file source stays `file`; any other profile changed here is now this machine's own copy.
export const changeProfile = async (change: (profile: Profile) => Profile): Promise<Profile> => {
  const next = await mutateProfile(() => change(editableProfile()));
  if ((await loadMachine()).profileSource !== 'file') await setProfileSource('default');
  return next;
};
