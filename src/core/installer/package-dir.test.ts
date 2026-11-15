import { describe, expect, vi } from 'vitest';
import { test } from '../../test/config-dir.js';
import { npmFromFixtures } from '../../test/npm-fixtures.js';
import { type Npm } from './npm.js';
import { installPackage, packageDir } from './package-dir.js';

const PROBE = { id: 'probe', name: '@agentage/fixture-probe', version: '0.2.0', registries: {} };

describe('one npm tree per extension version', () => {
  test('installs id@version once; a second call reuses the tree with no npm', async ({ dir }) => {
    const npm = vi.fn(await npmFromFixtures());
    expect(packageDir('probe', '0.2.0')).toBeNull();
    const at = await installPackage(PROBE, npm);
    expect(at).toBe(
      dir.at('extensions/packages/trees/probe@0.2.0/node_modules/@agentage/fixture-probe')
    );
    expect(packageDir('probe', '0.2.0')).toBe(at);
    expect(await installPackage(PROBE, npm)).toBe(at);
    expect(npm).toHaveBeenCalledTimes(1);
  });

  test('scope registries go into the tree .npmrc', async ({ dir }) => {
    const registries = { '@agentage': 'http://127.0.0.1:9/' };
    await installPackage({ ...PROBE, registries }, await npmFromFixtures());
    expect(dir.file('extensions/packages/trees/probe@0.2.0/.npmrc')).toBe(
      '@agentage:registry=http://127.0.0.1:9/'
    );
  });

  test('a failed npm install leaves no tree and names the reason', async ({ dir }) => {
    const npm: Npm = async () => ({ code: 1, stdout: '', stderr: 'npm error E404 not found' });
    await expect(installPackage(PROBE, npm)).rejects.toThrow(
      'npm install @agentage/fixture-probe@0.2.0 failed (exit 1)\nnpm error E404 not found'
    );
    expect(packageDir('probe', '0.2.0')).toBeNull();
    expect(dir.list('extensions/packages/trees')).toEqual([]);
  });
});
