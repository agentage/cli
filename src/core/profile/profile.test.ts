import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { pkg, test } from '../../test/config-dir.js';
import { defaultProfile, mutateProfile, readProfile } from './profile.js';

describe('profile.json', () => {
  test('when absent, there is no profile', () => {
    expect(readProfile()).toBeNull();
  });

  test('that is not JSON is reported, never read as absent', ({ dir }) => {
    dir.write('profile.json', '{ nope');
    expect(readProfile()).toEqual({ ok: false, errors: ['not valid JSON'] });
  });

  test('that cannot be read is reported', ({ dir }) => {
    dir.write('profile.json/inside', '');
    expect(readProfile()).toEqual({ ok: false, errors: [expect.stringContaining('EISDIR')] });
  });

  test('is saved with mode 0600, creating the config dir; the default names no extensions', async ({
    dir,
  }) => {
    await mutateProfile(() => defaultProfile());
    expect(dir.json('profile.json')).toEqual({
      version: 1,
      extensions: {},
      config: {},
      machines: {},
    });
    expect(statSync(dir.at('profile.json')).mode & 0o777).toBe(0o600);
  });

  test('a save starts from the newest local copy and keeps keys this CLI does not know', async ({
    dir,
  }) => {
    dir.profile({ extensions: { hello: '^1' }, teams: ['a'] });
    await mutateProfile((current) => ({
      ...defaultProfile(),
      ...current,
      extensions: { ...current?.extensions, [pkg('world')]: '^1' },
    }));
    expect(dir.json('profile.json')).toMatchObject({
      extensions: { [pkg('hello')]: '^1', [pkg('world')]: '^1' },
      teams: ['a'],
    });
  });
});
