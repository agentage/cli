/**
 * The loopback npm registry as one test sees it: the fixtures, packed once per worker, served by
 * a registry of the test's own, so a version one test publishes never reaches another.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packFolders, startRegistry } from '../registry/registry.js';

export interface TestRegistry {
  // What the profiles send `@agentage` to.
  url: string;
  // Publishes fixtures/extension-<name> at `version`, `fields` replacing its package.json's own,
  // e.g. publish('hello', '2.0.0', { engines: { agentage: '^2' } }).
  publish: (name: string, version: string, fields?: Record<string, unknown>) => Promise<void>;
}

// A copy of fixtures/extension-<name> as that version would be published.
const bumped = (scratch: string, name: string, version: string, fields: object): string => {
  const dir = join(scratch, `extension-${name}-${version}`);
  cpSync(join(process.cwd(), 'fixtures', `extension-${name}`), dir, { recursive: true });
  const path = join(dir, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as object;
  writeFileSync(path, JSON.stringify({ ...manifest, ...fields, version }, null, 2));
  return dir;
};

export const testRegistry = async (packed: string) => {
  const scratch = mkdtempSync(join(tmpdir(), 'agentage-e2e-publish-'));
  const registry = await startRegistry(packed);
  const publish: TestRegistry['publish'] = async (name, version, fields = {}) => {
    const folder = bumped(scratch, name, version, fields);
    for (const tarball of await packFolders([folder], join(scratch, 'pack'), scratch))
      registry.add(tarball);
  };
  const close = async (): Promise<void> => {
    await registry.close();
    rmSync(scratch, { recursive: true, force: true });
  };
  return { url: registry.url, publish, close };
};
