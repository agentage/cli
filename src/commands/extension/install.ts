import { type Npm, type NpmManifest } from '../../core/installer/npm.js';
import { registryLookup, resolveName, type Resolved } from '../../core/installer/resolve.js';
import { addExtension, changeProfile } from '../../core/profile/edit.js';
import { loadMachine, setDev } from '../../core/profile/machine.js';
import { editableProfile } from '../../core/profile/profile.js';
import { installAndLoad, line } from './install-load.js';

export interface ExtensionInstallOptions {
  name: string;
  off?: boolean;
}

// npm is the only seam: it reads what a name resolves to, then installs the tree.
export interface ExtensionInstallDeps {
  npm: () => Promise<Npm>;
  manifest: () => Promise<NpmManifest>;
}

type Package = Extract<Resolved, { kind: 'package' }>;
type Dev = Extract<Resolved, { kind: 'dev' }>;

const addPackage = async (target: Package, off: boolean): Promise<void> => {
  const { id } = await loadMachine();
  await changeProfile((profile) => addExtension(profile, target.name, target.spec, id, off));
  console.log(line('added', `${target.name} ${target.spec}${off ? ' (off on this machine)' : ''}`));
};

// A dev extension is this machine's own and replaces an installed copy of the same package.
const addDev = async (target: Dev, off: boolean): Promise<void> => {
  if (off) throw new Error(`--off does not apply to ${target.path}: a dev extension always loads`);
  await setDev(target.name, target.path);
  console.log(line('dev', `${target.name} ${target.path}`));
};

// Never signs in: the name is looked up in the registries the local profile routes.
export const runExtensionInstall = async (
  opts: ExtensionInstallOptions,
  deps: ExtensionInstallDeps
): Promise<void> => {
  const { registries } = editableProfile();
  const target = await resolveName(opts.name, registryLookup(deps.manifest, registries));
  if (target.kind === 'dev') await addDev(target, opts.off === true);
  else await addPackage(target, opts.off === true);
  await installAndLoad(editableProfile(), deps.npm);
};
