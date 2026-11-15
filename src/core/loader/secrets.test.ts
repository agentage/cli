import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { secretsFor } from './secrets.js';

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
