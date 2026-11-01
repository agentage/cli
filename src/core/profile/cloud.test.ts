import { describe, expect } from 'vitest';
import { fakeAccount } from '../../test/account.js';
import { test } from '../../test/config-dir.js';
import { pullProfile, pushProfile, type CloudFetch } from './cloud.js';

const HELLO = { version: 1, extensions: { '@agentage/fixture-hello': '^1.0.0' } };
const LOCK = { lockfileVersion: 3, packages: { '': {} } };
const WRITE = { version: 1, profile: HELLO, lock: LOCK, npmMajor: 10 };

describe('pulling the profile from the account', () => {
  test('with the etag of the local copy, an unchanged profile answers 304: the local copy is current', async () => {
    const account = fakeAccount();
    const etag = account.store(HELLO);
    expect(await pullProfile(account.fetch, etag)).toEqual({ kind: 'current' });
    expect(account.requests).toMatchObject([
      { method: 'GET', path: '/v1/profile', headers: { 'if-none-match': etag }, status: 304 },
    ]);
  });

  test('a profile changed elsewhere comes back parsed, with its lock, npm major and new etag', async () => {
    const account = fakeAccount();
    account.store({ version: 0 });
    const etag = account.store(HELLO, LOCK, 10);
    const pulled = await pullProfile(account.fetch, '"etag-0001"');
    expect(pulled).toMatchObject({
      kind: 'found',
      doc: { etag, lock: LOCK, npmMajor: 10, readOnly: false },
    });
    expect(pulled.kind === 'found' && pulled.doc.profile.extensions).toEqual(HELLO.extensions);
  });

  test('without an etag no If-None-Match is sent, and an account without a profile is none', async () => {
    const account = fakeAccount();
    expect(await pullProfile(account.fetch, null)).toEqual({ kind: 'none' });
    expect(account.requests[0]?.headers).toEqual({});
  });

  test('a 404 other than PROFILE_NOT_FOUND, from an API without the profile route, is unavailable, not none', async () => {
    const answering =
      (body: string): CloudFetch =>
      async () =>
        new Response(body, { status: 404 });
    const noRoute = JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no such endpoint' } });
    expect(await pullProfile(answering(noRoute), null)).toEqual({
      kind: 'unavailable',
      reason: '404 NOT_FOUND',
    });
    expect(await pullProfile(answering('<html>'), null)).toEqual({
      kind: 'unavailable',
      reason: '404',
    });
  });

  test('a newer profile version comes back read-only', async () => {
    const account = fakeAccount();
    account.store({ version: 2, extensions: {} });
    expect(await pullProfile(account.fetch, null)).toMatchObject({ doc: { readOnly: true } });
  });

  test('a 503, a dead network, a timeout or an invalid document is unavailable, saying why', async () => {
    const reasons = [];
    for (const how of [503, 'network', 'timeout'] as const) {
      const account = fakeAccount();
      account.fail('profile', how);
      reasons.push(await pullProfile(account.fetch, null, 2000));
      expect(account.requests[0]?.timeoutMs).toBe(2000);
    }
    const invalid = fakeAccount();
    invalid.store({ version: 1, extensions: { x: 'file:../x' } });
    reasons.push(await pullProfile(invalid.fetch, null));
    expect(reasons).toEqual([
      { kind: 'unavailable', reason: '503 INTERNAL' },
      { kind: 'unavailable', reason: 'fetch failed' },
      { kind: 'unavailable', reason: 'timed out' },
      {
        kind: 'unavailable',
        reason:
          'the profile in your account is invalid: extensions["x"]: file: specs are refused; use a semver range or an https: tarball URL',
      },
    ]);
  });
});

describe('pushing the profile to the account', () => {
  test('If-Match with the etag it was pulled at replaces it and returns the new etag', async () => {
    const account = fakeAccount();
    const etag = account.store({ version: 1 });
    const pushed = await pushProfile(account.fetch, WRITE, etag);
    expect(pushed).toEqual({ kind: 'stored', etag: account.stored?.etag });
    expect(account.requests[0]).toMatchObject({
      method: 'PUT',
      headers: { 'if-match': etag, 'content-type': 'application/json' },
      body: WRITE,
    });
    expect(account.stored).toMatchObject({ profile: HELLO, lock: LOCK, npmMajor: 10 });
  });

  test('without an etag it creates the profile with If-None-Match: *', async () => {
    const account = fakeAccount();
    expect(await pushProfile(account.fetch, WRITE, null)).toMatchObject({ kind: 'stored' });
    expect(account.requests[0]?.headers['if-none-match']).toBe('*');
  });

  test('a push that lost the race (412) returns the document now in the account', async () => {
    const account = fakeAccount();
    const stale = account.store({ version: 1 });
    const newer = account.store(HELLO, LOCK, 11);
    expect(await pushProfile(account.fetch, WRITE, stale)).toMatchObject({
      kind: 'conflict',
      current: { etag: newer, lock: LOCK, npmMajor: 11, profile: { extensions: HELLO.extensions } },
    });
  });

  test('any other answer throws: not pushed, naming the status, the code or the network error', async () => {
    const account = fakeAccount();
    account.fail('profile', 503);
    await expect(pushProfile(account.fetch, WRITE, '"etag-0001"')).rejects.toThrow(
      'not pushed to your account (503 INTERNAL)'
    );
    account.fail('profile', 'network');
    await expect(pushProfile(account.fetch, WRITE, null)).rejects.toThrow(
      'not pushed to your account (fetch failed)'
    );
  });
});
