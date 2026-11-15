import { join } from 'node:path';
import { type Installer } from '@agentage/extension/host';
import { installPackage, packageDir } from '../../core/installer/package-dir.js';
import { type Npm, type NpmManifest } from '../../core/installer/npm.js';
import { registryLookup, resolveName, type Found } from '../../core/installer/resolve.js';
import { editableProfile } from '../../core/profile/profile.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { CliError } from '../../lib/json-output.js';
import { type Market } from '../../lib/net/market.js';

export interface InstallerDeps {
  npm: () => Promise<Npm>;
  manifest: () => Promise<NpmManifest>;
  // A new one per install: the daemon runs for days, a market outage must not stick.
  market: () => Market;
}

type Registry = ReturnType<typeof registryLookup>;

// The market names the package and its newest version; without it npm alone decides.
const inputOf = async (id: string, version: string | undefined, market: Market) => {
  const latest = await market.latest(id);
  if (latest?.package === null)
    throw new CliError('private_entry', `${id}: private entry, no npm package to install`);
  if (latest) return `${latest.package}@${version ?? latest.version}`;
  return version ? `${id}@${version}` : id;
};

// The one exact version npm has for the input: a range, a version, or the newest that fits.
const exact = async (input: string, registry: Registry): Promise<Found> => {
  const target = await resolveName(input, registry);
  if (target.kind !== 'package') throw new CliError('validation_error', `${input}: not an id`);
  const found = await registry.find(`${target.name}@${target.spec}`);
  if (!found) throw new CliError('not_found', `${input}: npm has no such version`);
  return found;
};

// The package must be the extension it was asked for.
const checkId = (dir: string, id: string): void => {
  const agentage = readJson(join(dir, 'package.json'), isRecord)?.['agentage'];
  const got = isRecord(agentage) ? agentage['id'] : undefined;
  if (got !== id) throw new CliError('validation_error', `${dir}: agentage.id is ${String(got)}`);
};

// The daemon's installer: the market, then npm into one folder per version (idempotent).
export const cliInstaller =
  (deps: InstallerDeps): Installer =>
  async ({ id, version }) => {
    const have = version ? packageDir(id, version) : null;
    if (version && have) return { id, version, dir: have };
    const { registries } = editableProfile();
    const registry = registryLookup(deps.manifest, registries);
    const found = await exact(await inputOf(id, version, deps.market()), registry);
    const spec = { id, name: found.name, version: found.version, registries };
    const dir = packageDir(id, found.version) ?? (await installPackage(spec, await deps.npm()));
    checkId(dir, id);
    return { id, version: found.version, dir };
  };
