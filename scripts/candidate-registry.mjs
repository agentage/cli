#!/usr/bin/env node
// The packed cli as npm `latest` on loopback, the rest proxied: the e2e cli tier then tests it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const UPSTREAM = 'https://registry.npmjs.org';
const NAME = '@agentage/cli';
const FILE = 'candidate.tgz';
const UPSTREAM_TIMEOUT_MS = 30_000;

const [tarball, urlFile] = process.argv.slice(2);
if (!tarball || !urlFile) {
  console.error('usage: node scripts/candidate-registry.mjs <tarball> <url-file>');
  process.exit(2);
}
const bytes = readFileSync(tarball);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const digest = (algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);

const packument = (url) => ({
  name: NAME,
  'dist-tags': { latest: manifest.version },
  versions: {
    [manifest.version]: {
      ...manifest,
      dist: {
        tarball: `${url}/${NAME}/-/${FILE}`,
        integrity: `sha512-${digest('sha512', 'base64')}`,
        shasum: digest('sha1', 'hex'),
      },
    },
  },
});

const send = (res, status, type, body) => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

// fetch decompresses, so the body goes back without the upstream content-encoding.
const proxy = async (req, res) => {
  try {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const headers = { accept: req.headers.accept ?? '*/*' };
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { headers, signal });
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
    send(res, upstream.status, type, Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    send(
      res,
      502,
      'text/plain',
      `upstream ${req.url}: ${err instanceof Error ? err.message : err}`
    );
  }
};

// npm escapes only the scope slash; a malformed escape is a 400, never a crash.
const pathOf = (req, url) => {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', url).pathname);
  } catch {
    return null;
  }
};

const route = (url) => (req, res) => {
  const path = pathOf(req, url);
  if (path === null) return send(res, 400, 'text/plain', 'malformed path');
  if (path === `/${NAME}`)
    return send(res, 200, 'application/json', JSON.stringify(packument(url)));
  if (path !== `/${NAME}/-/${FILE}`) return void proxy(req, res);
  console.log(`served ${NAME}@${manifest.version} (the candidate)`);
  send(res, 200, 'application/octet-stream', bytes);
};

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  server.on('request', route(url));
  writeFileSync(urlFile, url);
  console.log(`candidate registry ${url}: ${NAME}@${manifest.version} as latest`);
});
