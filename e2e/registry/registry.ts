import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { loadNpmCli } from './npm-cli.js';
import { readPackedManifest, type PackedManifest } from './tar.js';

interface PackedVersion {
  dir: string;
  file: string;
  manifest: PackedManifest;
  integrity: string;
  shasum: string;
}

type PackIndex = Map<string, PackedVersion[]>;

export interface Registry {
  url: string;
  // Serves one more `npm pack` tarball from now on, as a publish would.
  add: (tarball: string) => void;
  close: () => Promise<void>;
}

const pack = (dir: string, file: string): PackedVersion => {
  const bytes = readFileSync(join(dir, file));
  return {
    dir,
    file,
    manifest: readPackedManifest(bytes),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
  };
};

// A version published again replaces the one before, as on a registry that allows it.
const addTo = (index: PackIndex, packed: PackedVersion): void => {
  const { name, version } = packed.manifest;
  const others = (index.get(name) ?? []).filter((v) => v.manifest.version !== version);
  index.set(name, [...others, packed]);
};

const scan = (packDirs: string[]): PackIndex => {
  const index: PackIndex = new Map();
  for (const dir of packDirs)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tgz')))
      addTo(index, pack(dir, file));
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
  (url: string, index: PackIndex) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const [name = '', file] = requestPath(req, url).split('/-/');
    const versions = index.get(name);
    const packed = versions?.find((v) => v.file === file);
    if (req.method !== 'GET' || !versions) return sendJson(res, 404, { error: 'not found' });
    if (file === undefined) return sendJson(res, 200, packument(url, name, versions));
    if (!packed) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    createReadStream(join(packed.dir, packed.file)).pipe(res);
  };

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });

export const startRegistry = async (...packDirs: string[]): Promise<Registry> => {
  const index = scan(packDirs);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', serve(url, index));
  const add = (tarball: string): void => addTo(index, pack(dirname(tarball), basename(tarball)));
  return { url, add, close: () => closeServer(server) };
};

const FIXTURES = join(process.cwd(), 'fixtures');

// `npm pack` of `folders` into `destination`, npm's cache and userconfig kept under `root`.
export const packFolders = async (folders: string[], destination: string, root: string) => {
  mkdirSync(destination, { recursive: true });
  const env = { npm_config_userconfig: join(root, '.npmrc'), npm_config_cache: join(root, '.npm') };
  const { runNpm } = await loadNpmCli();
  const args = ['pack', ...folders, '--pack-destination', destination, '--json'];
  const packed = await runNpm(args, { env, timeoutMs: 120_000 });
  if (packed.code !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
  return (JSON.parse(packed.stdout) as { filename: string }[]).map((p) =>
    join(destination, p.filename)
  );
};

// Every fixtures/extension-* packed under `root`; returns the folder holding the tarballs.
export const packFixtures = async (root: string): Promise<string> => {
  const dirs = readdirSync(FIXTURES).filter((n) => n.startsWith('extension-'));
  const packDir = join(root, 'pack');
  await packFolders(
    dirs.map((d) => join(FIXTURES, d)),
    packDir,
    root
  );
  return packDir;
};
