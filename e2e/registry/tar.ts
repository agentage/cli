import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

export type PackedManifest = Record<string, unknown> & { name: string; version: string };

const field = (header: Buffer, start: number, length: number): string => {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
};

// Only POSIX ustar splits long names into prefix + name; GNU headers reuse those bytes.
const entryPath = (header: Buffer): string => {
  const name = field(header, 0, 100);
  const prefix = field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
  return prefix ? `${prefix}/${name}` : name;
};

export const readTarEntry = (tgz: Buffer, path: string): Buffer | undefined => {
  const tar = gunzipSync(tgz);
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return undefined;
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const body = offset + BLOCK;
    if (entryPath(header) === path) return tar.subarray(body, body + size);
    offset = body + Math.ceil(size / BLOCK) * BLOCK;
  }
  return undefined;
};

export const readPackedManifest = (tgz: Buffer): PackedManifest => {
  const raw = readTarEntry(tgz, 'package/package.json');
  if (!raw) throw new Error('tarball has no package/package.json');
  const manifest = JSON.parse(raw.toString('utf8')) as Partial<PackedManifest>;
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('packed package.json lacks a name or version');
  }
  return manifest as PackedManifest;
};
