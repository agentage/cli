import { EXTENSION_API_VERSION } from '../../extension.js';
import { isRecord } from '../../lib/fs/json-file.js';
import { kitVersion } from '../kit-version.js';
import { manifestInfo } from '../loader/manifest.js';
import { isRange, newestFirst, satisfies } from '../semver-range.js';

// One published version and its engines.agentage: over the kit when `kit`, else the extension API.
export interface Published {
  version: string;
  engine: string;
  kit?: boolean;
}

export interface Compatible {
  // null when no published version fits.
  version: string | null;
  // Newer than `version` (all of them when it is null), newest first: their engine does not fit.
  skipped: Published[];
}

// The versions a range is checked against: the extension API, and the kit for kit-shaped ones.
export interface Gate {
  api: string;
  kit: string;
}

export const cliGate = (): Gate => ({ api: EXTENSION_API_VERSION, kit: kitVersion() });

export const fitsApi = (engine: string, api: string = EXTENSION_API_VERSION): boolean =>
  isRange(engine) && satisfies(api, engine);

// The gate picks the API by manifest shape.
export const fits = (p: Omit<Published, 'version'>, gate: Gate = cliGate()): boolean =>
  fitsApi(p.engine, p.kit ? gate.kit : gate.api);

export const needsText = ({ engine, kit }: Omit<Published, 'version'>): string =>
  `needs ${kit ? 'kit' : 'extension API'} ${engine}`;

export const needs = (p: Published): string => `${p.version}: ${needsText(p)}`;

// The resolver's rule: the newest version this CLI can load, instead of whatever `latest` is.
export const newestCompatible = (published: Published[], gate: Gate = cliGate()): Compatible => {
  const sorted = [...published].sort((a, b) => newestFirst(a.version, b.version));
  const at = sorted.findIndex((p) => fits(p, gate));
  if (at === -1) return { version: null, skipped: sorted };
  return { version: sorted[at]?.version ?? null, skipped: sorted.slice(0, at) };
};

// npm view names a nested field by its path: `agentage.parts`.
const publishedOf = (item: unknown): Published | null => {
  if (typeof item === 'string') return { version: item, engine: manifestInfo({}).engine };
  if (!isRecord(item) || typeof item['version'] !== 'string') return null;
  const parts = item['agentage.parts'];
  const info = manifestInfo(parts === undefined ? item : { ...item, agentage: { parts } });
  const kit = info.kind === 'kit' ? { kit: true } : {};
  return { version: item['version'], engine: info.engine, ...kit };
};

// npm view prints one object per version, a lone object for one version, or bare versions.
export const parsePublished = (stdout: string): Published[] | null => {
  if (stdout.trim() === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  const items = (Array.isArray(value) ? value : [value]).map(publishedOf);
  return items.every((p): p is Published => p !== null) ? items : null;
};
