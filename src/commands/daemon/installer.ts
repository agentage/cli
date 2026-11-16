import { join } from 'node:path';
import type { Installer } from '@agentage/extension/host';
import { installedDir, installedName } from '../../core/installer/old-tree.js';
import { installPackage, packageDir } from '../../core/installer/package-dir.js';
import { type Npm, type NpmManifest } from '../../core/installer/npm.js';
import {
  candidatesFor,
  registryLookup,
  resolveName,
  type Found,
} from '../../core/installer/resolve.js';
import { isRange } from '../../core/semver-range.js';
import { DIST_TAG, isVersionSpec } from '../../core/installer/version-spec.js';
import { editableProfile } from '../../core/profile/profile.js';
import { isRecord, readJson } from '../../lib/fs/json-file.js';
import { type CliError, messageOf } from '../../lib/json-output.js';
import { type Market } from '../../lib/net/market.js';
import { npmFallbackLine, noSiteMarket } from '../../lib/net/market-error.js';
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

// A market: the scoped name only (anyone can publish the other); no market: as cli 0.51.1.
const npmName = (id: string, down: CliError | null): string =>
  noSiteMarket(down) ? (installedName(id) ?? id) : `@agentage/extension-${id}`;

// The market names the package and its newest version; without it npm alone decides.
const inputOf = async (id: string, version: string | undefined, market: Market) => {
  const latest = await market.latest(id);
  if (latest?.package === null)
    throw installError('PRIVATE_ENTRY', 400, `${id}: private entry, no npm package to install`);
  if (latest) return `${latest.package}@${version ?? latest.version}`;
  const down = market.down();
  if (!version && down && !noSiteMarket(down)) throw marketDown(id, down);
  const line = version ? null : npmFallbackLine(siteFqdn(), id, `${id} resolves`, down);
  if (line) console.error(line);
  const name = npmName(id, down);
  return version ? `${name}@${version}` : name;
};

// npm's reasons as codes: absent is NOT_FOUND, a registry that fails is INSTALL_FAILED.
const resolveError = (err: unknown): Error => {
  const message = messageOf(err);
  if (/not found|no published version|No matching version|ETARGET/.test(message))
    return installError('NOT_FOUND', 404, message);
  if (message.startsWith('npm ')) return installError('INSTALL_FAILED', 502, message);
  return installError('VALIDATION_ERROR', 400, message);
};

// `fixture@broken`: a word that is not a range is a dist-tag, resolved by npm as npm does.
export const distTagOf = (input: string): { name: string; tag: string } | null => {
  const at = input.lastIndexOf('@');
  const tag = at > 0 ? input.slice(at + 1) : '';
  return DIST_TAG.test(tag) && !isRange(tag) ? { name: input.slice(0, at), tag } : null;
};

const tagged = async (input: string, registry: Registry): Promise<Found | null> => {
  const { name, tag } = distTagOf(input) ?? { name: '', tag: '' };
  for (const candidate of candidatesFor(name)) {
    const found = await registry.find(`${candidate}@${tag}`).catch((err: unknown) => {
      throw resolveError(err);
    });
    if (found) return found;
  }
  return null;
};

// The one exact version npm has for a range, a version, a dist-tag, or the newest that fits.
const exact = async (input: string, registry: Registry): Promise<Found> => {
  if (distTagOf(input)) {
    const found = await tagged(input, registry);
    if (found) return found;
    throw installError('NOT_FOUND', 404, `${input}: npm has no such dist-tag`);
  }
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

// A version on disk needs no network; else the market, then npm into one folder per version.
export const cliInstaller =
  (deps: InstallerDeps): Installer =>
  async ({ id, version }) => {
    if (version !== undefined && !isVersionSpec(version))
      throw installError(
        'VALIDATION_ERROR',
        400,
        `${id}@${version}: not a version, range or dist-tag`
      );
    const have = version ? installedDir(id, version) : null;
    if (version && have) return { id, version, dir: have };
    const registry = registryLookup(deps.manifest, editableProfile().registries);
    const found = await exact(await inputOf(id, version, deps.market()), registry);
    const dir = packageDir(id, found.version) ?? (await fetched(id, found, deps));
    checkId(dir, id);
    return { id, version: found.version, dir };
  };

// No market: the newest runnable version of the npm name the row was installed under, no other.
export const npmNewest =
  (manifest: () => Promise<NpmManifest>) =>
  async (id: string): Promise<string> =>
    (await exact(installedName(id) ?? id, registryLookup(manifest, editableProfile().registries)))
      .version;
