import { describe, expect, it } from 'vitest';
import { npmArgs } from './npm.js';

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
});
