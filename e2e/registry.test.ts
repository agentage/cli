import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { resolveNpmCli } from './registry/npm-cli.js';
import { startRegistry, type Registry } from './registry/registry.js';

// Serves `npm pack` output on loopback so e2e installs never touch the public registry. @p0
const run = promisify(execFile);
const FIXTURE = join(process.cwd(), 'fixtures', 'plugin-hello');
const NAME = '@agentage/fixture-hello';

interface Packument {
  name: string;
  'dist-tags': { latest: string };
  versions: Record<string, { version: string; dist: { tarball: string; integrity: string } }>;
}

test.describe('in-process npm registry @p0 @offline', () => {
  let root = '';
  let registry: Registry | undefined;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'agentage-registry-'));
    const packDir = join(root, 'pack');
    mkdirSync(packDir);
    const env = {
      ...process.env,
      npm_config_userconfig: join(root, '.npmrc'),
      npm_config_cache: join(root, '.npm'),
    };
    const args = [resolveNpmCli(), 'pack', FIXTURE, '--pack-destination', packDir];
    await run(process.execPath, args, { env, timeout: 60_000 });
    registry = await startRegistry(packDir);
  });

  test.afterAll(async () => {
    await registry?.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('serves the packument and a tarball matching its integrity', async () => {
    const url = registry?.url ?? '';
    const res = await fetch(`${url}/${encodeURIComponent(NAME)}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Packument;
    expect(doc.name).toBe(NAME);
    expect(doc['dist-tags'].latest).toBe('1.0.0');
    const dist = doc.versions['1.0.0']?.dist;
    expect(dist?.tarball.startsWith(`${url}/${NAME}/-/`)).toBe(true);
    const tarball = await fetch(dist?.tarball ?? '');
    const bytes = Buffer.from(await tarball.arrayBuffer());
    const sha512 = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    expect(sha512).toBe(dist?.integrity);
  });

  test('anything else is a JSON 404', async () => {
    const url = registry?.url ?? '';
    for (const path of ['/@agentage%2fmissing', `/${NAME}/-/nope.tgz`, '/']) {
      const res = await fetch(`${url}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    }
  });
});
