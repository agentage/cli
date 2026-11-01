import { describe, expect, it } from 'vitest';
import { manifestArgs, npmArgs, npmMajor } from './npm.js';

describe('npm, as the installer runs it', () => {
  it('installs into the staged tree without scripts, unlisted scopes from the public registry', () => {
    expect(npmArgs('ci', '/x/extensions/trees/.staging-1', {})).toEqual([
      'ci',
      '--prefix',
      '/x/extensions/trees/.staging-1',
      '--registry',
      'https://registry.npmjs.org',
      '--ignore-scripts',
      '--no-update-notifier',
    ]);
  });

  it("keeps the caller's npm userconfig and cache, in either spelling, as flags", () => {
    const env = { npm_config_userconfig: '/h/.npmrc', NPM_CONFIG_CACHE: '/c', HOME: '/h' };
    expect(npmArgs('install', '/t', env).slice(-4)).toEqual([
      '--userconfig',
      '/h/.npmrc',
      '--cache',
      '/c',
    ]);
  });

  it('updates only the packages it names, when it names any', () => {
    expect(npmArgs('update', '/t', {}, ['@agentage/fixture-world']).slice(0, 4)).toEqual([
      'update',
      '@agentage/fixture-world',
      '--prefix',
      '/t',
    ]);
    expect(npmArgs('update', '/t', {}).slice(0, 2)).toEqual(['update', '--prefix']);
  });

  it('reads what a spec resolves to with pack --dry-run, each profile scope sent to its registry', () => {
    const registries = { '@agentage': 'http://127.0.0.1:9' };
    expect(
      manifestArgs('pack', '@agentage/x', registries, '/x/extensions', { NPM_CONFIG_CACHE: '/c' })
    ).toEqual([
      'pack',
      '@agentage/x',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--prefix',
      '/x/extensions',
      '--registry',
      'https://registry.npmjs.org',
      '--@agentage:registry=http://127.0.0.1:9',
      '--no-update-notifier',
      '--cache',
      '/c',
    ]);
  });

  it('reads every release and its engines with view, through the same registries', () => {
    const registries = { '@agentage': 'http://127.0.0.1:9' };
    expect(manifestArgs('view', '@agentage/x@>=0.0.0', registries, '/x/extensions', {})).toEqual([
      'view',
      '@agentage/x@>=0.0.0',
      'name',
      'version',
      'engines',
      '--json',
      '--ignore-scripts',
      '--prefix',
      '/x/extensions',
      '--registry',
      'https://registry.npmjs.org',
      '--@agentage:registry=http://127.0.0.1:9',
      '--no-update-notifier',
    ]);
  });

  it('reports the major of the npm it runs, 10 or newer', async () => {
    expect(await npmMajor()).toBeGreaterThanOrEqual(10);
  });
});
