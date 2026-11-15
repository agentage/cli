import { join } from 'node:path';
import type { Installer } from '@agentage/extension/host';
import { installedDir } from '../../core/installer/old-tree.js';
import { installPackage, packageDir } from '../../core/installer/package-dir.js';
import { type Npm, type NpmManifest } from '../../core/installer/npm.js';
import { registryLookup, resolveName, type Found } from '../../core/installer/resolve.js';
import { editableProfile } from '../../core/profile/profile.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type CliError, messageOf } from '../../lib/json-output.js';
import { type Market } from '../../lib/net/market.js';
import { fromNpmLine, noSiteMarket } from '../../lib/net/market-error.js';
import { siteFqdn } from '../../lib/net/origins.js';

export interface InstallerDeps {
  npm: () => Promise<Npm>;
  manifest: () => Promise<NpmManifest>;
  // A new one per install: the daemon runs for days, a market outage must not stick.
  market: () => Market;
}

type Registry = ReturnType<typeof registryLookup>;

// The kit sends an error with a string code to the client as that envelope (404, 502, else 400).
export const installError = (code: string, status: 400 | 404 | 502, message: string): Error =>
  Object.assign(new Error(message), { code, status });

// The market's own reason, in the daemon's case (market_failed is MARKET_FAILED).
const marketDown = (id: string, why: CliError): Error =>
  installError(why.code.toUpperCase(), 502, `${id}: ${why.message}`);

// The market names the package and its newest version; without it npm alone decides.
const inputOf = async (id: string, version: string | undefined, market: Market) => {
  const latest = await market.latest(id);
  if (latest?.package === null)
    throw installError('PRIVATE_ENTRY', 400, `${id}: private entry, no npm package to install`);
  if (latest) return `${latest.package}@${version ?? latest.version}`;
  const down = market.down();
  if (!version && down && !noSiteMarket(down)) throw marketDown(id, down);
  if (!version && down) console.error(fromNpmLine(siteFqdn(), `${id} resolves`));
  return version ? `${id}@${version}` : id;
};

// npm's reasons as codes: absent is NOT_FOUND, a registry that fails is INSTALL_FAILED.
const resolveError = (err: unknown): Error => {
  const message = messageOf(err);
  if (/not found|no published version|No matching version|ETARGET/.test(message))
    return installError('NOT_FOUND', 404, message);
  if (message.startsWith('npm ')) return installError('INSTALL_FAILED', 502, message);
  return installError('VALIDATION_ERROR', 400, message);
};

// The one exact version npm has for the input: a range, a version, or the newest that fits.
const exact = async (input: string, registry: Registry): Promise<Found> => {
  const target = await resolveName(input, registry).catch((err: unknown) => {
    throw resolveError(err);
  });
  if (target.kind !== 'package') throw installError('VALIDATION_ERROR', 400, `${input}: not an id`);
  const found = await registry.find(`${target.name}@${target.spec}`).catch((err: unknown) => {
    throw resolveError(err);
  });
  if (!found) throw installError('NOT_FOUND', 404, `${input}: npm has no such version`);
  return found;
};

// The package must be the extension it was asked for.
const checkId = (dir: string, id: string): void => {
  const agentage = readJson(join(dir, 'package.json'), isRecord)?.['agentage'];
  const got = isRecord(agentage) ? agentage['id'] : undefined;
  if (got !== id)
    throw installError('VALIDATION_ERROR', 400, `${dir}: agentage.id is ${String(got)}`);
};

const fetched = async (id: string, found: Found, deps: InstallerDeps): Promise<string> => {
  const { registries } = editableProfile();
  const spec = { id, name: found.name, version: found.version, registries };
  return installPackage(spec, await deps.npm()).catch((err: unknown) => {
    throw installError('INSTALL_FAILED', 502, messageOf(err));
  });
};

// The daemon's installer: a version on disk (its own tree or the 0.51 one) needs no network;
// otherwise the market, then npm into one folder per version (idempotent).
export const cliInstaller =
  (deps: InstallerDeps): Installer =>
  async ({ id, version }) => {
    const have = version ? installedDir(id, version) : null;
    if (version && have) return { id, version, dir: have };
    const registry = registryLookup(deps.manifest, editableProfile().registries);
    const found = await exact(await inputOf(id, version, deps.market()), registry);
    const dir = packageDir(id, found.version) ?? (await fetched(id, found, deps));
    checkId(dir, id);
    return { id, version: found.version, dir };
  };

// The newest version npm has that this cli can run, by the 0.51 names (for update on such a site).
export const npmNewest =
  (manifest: () => Promise<NpmManifest>) =>
  async (id: string): Promise<string> =>
    (await exact(id, registryLookup(manifest, editableProfile().registries))).version;
