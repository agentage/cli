import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { readPackedManifest, type PackedManifest } from './tar.js';

interface PackedVersion {
  file: string;
  manifest: PackedManifest;
  integrity: string;
  shasum: string;
}

type PackIndex = Map<string, PackedVersion[]>;

export interface Registry {
  url: string;
  close: () => Promise<void>;
}

const pack = (packDir: string, file: string): PackedVersion => {
  const bytes = readFileSync(join(packDir, file));
  return {
    file,
    manifest: readPackedManifest(bytes),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
  };
};

const scan = (packDir: string): PackIndex => {
  const index: PackIndex = new Map();
  for (const file of readdirSync(packDir).filter((f) => f.endsWith('.tgz'))) {
    const packed = pack(packDir, file);
    const name = packed.manifest.name;
    index.set(name, [...(index.get(name) ?? []), packed]);
  }
  return index;
};

// Release versions only: compares numeric major.minor.patch and ignores prerelease tags.
const isNewer = (a: string, b: string): boolean => {
  const parse = (v: string): number[] => (v.split('-')[0] ?? '').split('.').map(Number);
  const x = parse(a);
  const y = parse(b);
  const i = x.findIndex((n, k) => n !== y[k]);
  return i !== -1 && (x[i] ?? 0) > (y[i] ?? 0);
};

const packument = (url: string, name: string, versions: PackedVersion[]): object => ({
  name,
  'dist-tags': {
    latest: versions
      .map((v) => v.manifest.version)
      .reduce((best, v) => (isNewer(v, best) ? v : best)),
  },
  versions: Object.fromEntries(
    versions.map(({ file, manifest, integrity, shasum }) => [
      manifest.version,
      { ...manifest, dist: { tarball: `${url}/${name}/-/${file}`, integrity, shasum } },
    ])
  ),
});

const sendJson = (res: ServerResponse, status: number, body: object): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// npm escapes only the scope slash (`@scope%2fname`); decoding the whole path accepts both forms.
const requestPath = (req: IncomingMessage, url: string): string => {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', url).pathname).slice(1);
  } catch {
    return '';
  }
};

const serve =
  (url: string, packDir: string, index: PackIndex) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const [name = '', file] = requestPath(req, url).split('/-/');
    const versions = index.get(name);
    const packed = versions?.find((v) => v.file === file);
    if (req.method !== 'GET' || !versions) return sendJson(res, 404, { error: 'not found' });
    if (file === undefined) return sendJson(res, 200, packument(url, name, versions));
    if (!packed) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    createReadStream(join(packDir, packed.file)).pipe(res);
  };

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });

export const startRegistry = async (packDir: string): Promise<Registry> => {
  const index = scan(packDir);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', serve(url, packDir, index));
  return { url, close: () => closeServer(server) };
};
