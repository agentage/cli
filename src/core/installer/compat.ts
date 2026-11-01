import { EXTENSION_API_VERSION } from '../../extension.js';
import { isRecord } from '../../lib/fs/json-file.js';
import { manifestInfo } from '../loader/manifest.js';
import { isRange, newestFirst, satisfies } from '../semver-range.js';

// One published version and the extension API range its engines.agentage asks for (absent: ^1).
export interface Published {
  version: string;
  engine: string;
}

export interface Compatible {
  // null when no published version fits.
  version: string | null;
  // Newer than `version` (all of them when it is null), newest first: their engine does not fit.
  skipped: Published[];
}

export const fitsApi = (engine: string, api: string = EXTENSION_API_VERSION): boolean =>
  isRange(engine) && satisfies(api, engine);

export const needs = ({ version, engine }: Published): string =>
  `${version}: needs extension API ${engine}`;

// The resolver's rule: the newest version this CLI can load, instead of whatever `latest` is.
export const newestCompatible = (
  published: Published[],
  api: string = EXTENSION_API_VERSION
): Compatible => {
  const sorted = [...published].sort((a, b) => newestFirst(a.version, b.version));
  const at = sorted.findIndex((p) => fitsApi(p.engine, api));
  if (at === -1) return { version: null, skipped: sorted };
  return { version: sorted[at]?.version ?? null, skipped: sorted.slice(0, at) };
};

const publishedOf = (item: unknown): Published | null => {
  if (typeof item === 'string') return { version: item, engine: manifestInfo({}).engine };
  if (!isRecord(item) || typeof item['version'] !== 'string') return null;
  return { version: item['version'], engine: manifestInfo(item).engine };
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
