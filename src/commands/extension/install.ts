import { needs } from '../../core/installer/compat.js';
import { type NpmManifest } from '../../core/installer/npm.js';
import { registryLookup, resolveName, type Resolved } from '../../core/installer/resolve.js';
import { addExtension } from '../../core/profile/edit.js';
import { loadMachine, setDev } from '../../core/profile/machine.js';
import { editableProfile } from '../../core/profile/profile.js';
import { type Market } from '../../lib/net/market.js';
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
  // Asked only for a bare id with no version; absent means npm alone decides.
  market?: Market;
}

type Package = Extract<Resolved, { kind: 'package' }>;
type Dev = Extract<Resolved, { kind: 'dev' }>;

const addPackage = async (target: Package, off: boolean, deps: ExtensionInstallDeps) => {
  for (const newer of target.skipped) console.log(line('skipped', needs(newer)));
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
  if (target.kit) console.log(line('linked', `${target.name} (working copy)`));
  else console.log(line('dev', `${target.name} ${target.path}`));
  await installAndLoad(editableProfile(), deps.npm);
};

const ID = /^[a-z][a-z0-9-]*$/;

// A bare id takes the version the market's /latest names; a private entry has no npm package.
const marketName = async (name: string, market?: Market): Promise<string> => {
  const latest = ID.test(name) ? await market?.latest(name) : null;
  if (!latest) return name;
  if (latest.package === null)
    throw new Error(`${name}: private entry, no npm package; it cannot be installed from npm`);
  return `${latest.package}@${latest.version}`;
};

// Never signs in: the name is looked up in the registries the local profile routes.
export const runExtensionInstall = async (
  opts: ExtensionInstallOptions,
  deps: ExtensionInstallDeps
): Promise<void> => {
  const { registries } = editableProfile();
  const target = await resolveName(
    await marketName(opts.name, deps.market),
    registryLookup(deps.manifest, registries)
  );
  if (target.kind === 'dev') await addDev(target, opts.off === true, deps);
  else await addPackage(target, opts.off === true, deps);
};
