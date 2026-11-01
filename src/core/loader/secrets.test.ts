import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { loadMachine } from '../profile/machine.js';
import { scan, loadSet } from './scan.js';
import { missingSecrets, secretsFor } from './secrets.js';

describe('ctx.secrets', () => {
  test('keeps values in secrets.json under the extension id, readable only by this user', async ({
    dir,
  }) => {
    const hello = secretsFor('hello');
    await hello.set('token', 'a');
    await secretsFor('world').set('token', 'b');
    expect(await hello.get('token')).toBe('a');
    expect(dir.json('secrets.json')).toEqual({ hello: { token: 'a' }, world: { token: 'b' } });
    expect(statSync(dir.at('secrets.json')).mode & 0o777).toBe(0o600);
    await hello.delete('token');
    expect(await hello.get('token')).toBeUndefined();
    expect(dir.json('secrets.json')).toEqual({ hello: {}, world: { token: 'b' } });
  });

  test('reads a secrets.json that is not JSON, or not namespaced, as no secrets', async ({
    dir,
  }) => {
    dir.write('secrets.json', '{ nope');
    expect(await secretsFor('hello').get('token')).toBeUndefined();
    dir.write('secrets.json', { hello: 'flat' });
    expect(await secretsFor('hello').get('token')).toBeUndefined();
  });
});

describe('the secrets setup lists', () => {
  test('are the keys an extension declares secret: true and this machine has not set', async ({
    dir,
  }) => {
    dir.profile({ extensions: { secret: '^1', hello: '^1.0.0' } });
    dir.tree('secret', 'hello');
    const extensions = loadSet(scan(await loadMachine()));
    expect(missingSecrets(extensions)).toEqual([{ id: 'secret', key: 'token' }]);
    await secretsFor('secret').set('token', 't');
    expect(missingSecrets(extensions)).toEqual([]);
  });
});
