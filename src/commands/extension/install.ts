import { type NpmManifest } from '../../core/installer/npm.js';
import { registryLookup, resolveName, type Resolved } from '../../core/installer/resolve.js';
import { addExtension } from '../../core/profile/edit.js';
import { loadMachine, setDev } from '../../core/profile/machine.js';
import { editableProfile } from '../../core/profile/profile.js';
import { type Profile } from '../../core/profile/schema.js';
import { installAndLoad, line } from './install-load.js';
import { finishEdit, pullForEdit, type EditDeps } from './sync.js';

export interface ExtensionInstallOptions {
  name: string;
  off?: boolean;
}

// npm reads what a name resolves to and installs the tree; the account gets the new profile.
export interface ExtensionInstallDeps extends EditDeps {
  manifest: () => Promise<NpmManifest>;
}

type Package = Extract<Resolved, { kind: 'package' }>;
type Dev = Extract<Resolved, { kind: 'dev' }>;

const addPackage = async (target: Package, off: boolean, deps: ExtensionInstallDeps) => {
  const synced = await pullForEdit(deps);
  const { id } = await loadMachine();
  const note = line('added', `${target.name} ${target.spec}${off ? ' (off on this machine)' : ''}`);
  const add = (profile: Profile) => addExtension(profile, target.name, target.spec, id, off);
  await finishEdit(synced, add, deps, note);
};

// A dev extension is this machine's own: it replaces an installed copy, and never syncs.
const addDev = async (target: Dev, off: boolean, deps: ExtensionInstallDeps) => {
  if (off) throw new Error(`--off does not apply to ${target.path}: a dev extension always loads`);
  await setDev(target.name, target.path);
  console.log(line('dev', `${target.name} ${target.path}`));
  await installAndLoad(editableProfile(), deps.npm);
};

// Never signs in: the name is looked up in the registries the local profile routes.
export const runExtensionInstall = async (
  opts: ExtensionInstallOptions,
  deps: ExtensionInstallDeps
): Promise<void> => {
  const { registries } = editableProfile();
  const target = await resolveName(opts.name, registryLookup(deps.manifest, registries));
  if (target.kind === 'dev') await addDev(target, opts.off === true, deps);
  else await addPackage(target, opts.off === true, deps);
};
