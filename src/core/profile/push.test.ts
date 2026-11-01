import { describe, expect } from 'vitest';
import { fakeAccount } from '../../test/account.js';
import { test } from '../../test/config-dir.js';
import { localProfile, type CloudProfile } from './cloud.js';
import { addExtension } from './edit.js';
import { defaultProfile } from './profile.js';
import { pushBody, pushWithReplay } from './push.js';
import { toDocument } from './schema.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';
const LOCK = { lockfileVersion: 3, packages: {} };
const OTHER_LOCK = { lockfileVersion: 3, packages: { '': { name: 'other' } } };

// The operation `extension install hello` replays: add hello to whatever document it gets.
const addHello = (bases: CloudProfile[]) => async (base: CloudProfile) => {
  bases.push(base);
  const next = addExtension(base.profile, HELLO, '^1.0.0', 'm_0000beef', false);
  return pushBody(next, base, { lock: LOCK, npmMajor: 10 });
};

// What `pullProfile` hands over for a stored profile.
const pulled = (account: ReturnType<typeof fakeAccount>): CloudProfile => ({
  ...localProfile(defaultProfile()),
  etag: account.stored?.etag ?? null,
});

const extensionsIn = (account: ReturnType<typeof fakeAccount>) =>
  account.stored?.profile['extensions'];

describe('pushing a change, replaying it once on a 412', () => {
  test('pushes once with If-Match when nobody pushed in between', async () => {
    const account = fakeAccount();
    const etag = account.store(toDocument(defaultProfile()));
    const bases: CloudProfile[] = [];
    const done = await pushWithReplay(account.fetch, pulled(account), addHello(bases));
    expect(done).toEqual({ etag: account.stored?.etag, pushed: true });
    expect(account.requests.map((r) => r.headers['if-match'])).toEqual([etag]);
    expect(bases).toHaveLength(1);
    expect(account.stored).toMatchObject({ lock: LOCK, npmMajor: 10 });
  });

  test("on a 412 replays the change exactly once on the account's newer document, then pushes with its etag", async () => {
    const account = fakeAccount();
    account.store(toDocument(defaultProfile()));
    const base = pulled(account);
    account.conflicts.push((doc) => ({ ...doc, extensions: { [WORLD]: '^1' } }));
    const bases: CloudProfile[] = [];
    const done = await pushWithReplay(account.fetch, base, addHello(bases));
    expect(account.requests.map((r) => r.status)).toEqual([412, 200]);
    expect(bases.map((b) => b.etag)).toEqual([base.etag, '"etag-0002"']);
    expect(done).toEqual({ etag: '"etag-0003"', pushed: true });
    expect(extensionsIn(account)).toEqual({ [WORLD]: '^1', [HELLO]: '^1.0.0' });
  });

  test('a second 412 throws, showing both documents', async () => {
    const account = fakeAccount();
    account.store(toDocument(defaultProfile()));
    const world = (doc: Record<string, unknown>) => ({ ...doc, extensions: { [WORLD]: '^1' } });
    account.conflicts.push(world, (doc) => ({ ...doc, config: { world: { x: 1 } } }));
    const failure = await pushWithReplay(account.fetch, pulled(account), addHello([])).catch(
      (e: Error) => e.message
    );
    expect(account.requests.map((r) => r.status)).toEqual([412, 412]);
    expect(failure).toMatch(/^not pushed: the profile in your account changed again/);
    expect(failure).toContain(`yours:\n{\n  "version": 1,\n  "extensions": {\n    "${WORLD}"`);
    expect(failure).toContain('in your account (etag "etag-0003"):\n{');
    expect(failure).toContain('"x": 1');
  });

  test("a replay that yields the account's document unchanged counts as pushed and sends nothing more", async () => {
    const account = fakeAccount();
    account.store(toDocument(defaultProfile()));
    const base = pulled(account);
    account.conflicts.push((doc) => ({ ...doc, extensions: { [HELLO]: '^1.0.0' } }));
    const done = await pushWithReplay(account.fetch, base, addHello([]));
    expect(account.requests.map((r) => r.status)).toEqual([412]);
    expect(done).toEqual({ etag: '"etag-0002"', pushed: false });
  });

  test('without an etag it creates the profile; one created meanwhile by another machine is adopted', async () => {
    const account = fakeAccount();
    const created = await pushWithReplay(account.fetch, localProfile(defaultProfile()), async (b) =>
      pushBody(b.profile, b, { lock: null, npmMajor: null })
    );
    expect(created).toEqual({ etag: '"etag-0001"', pushed: true });
    expect(account.requests[0]?.headers['if-none-match']).toBe('*');
    const adopted = await pushWithReplay(account.fetch, localProfile(defaultProfile()), async (b) =>
      pushBody(b.profile, b, { lock: null, npmMajor: null })
    );
    expect(adopted).toEqual({ etag: '"etag-0001"', pushed: false });
  });

  test('never pushes a profile of a newer version than this CLI understands', async () => {
    const account = fakeAccount();
    const newer = { ...localProfile({ ...defaultProfile(), version: 2 }), readOnly: true };
    await expect(pushWithReplay(account.fetch, newer, addHello([]))).rejects.toThrow(
      'the profile in your account is version 2, newer than this CLI understands; it was not changed'
    );
    expect(account.requests).toEqual([]);
  });
});

describe('the lock pushed next to the profile', () => {
  test('goes with the npm major that wrote it', () => {
    const base = { ...localProfile(defaultProfile()), lock: OTHER_LOCK, npmMajor: 10 };
    expect(pushBody(defaultProfile(), base, { lock: LOCK, npmMajor: 10 })).toEqual({
      version: 1,
      profile: toDocument(defaultProfile()),
      lock: LOCK,
      npmMajor: 10,
    });
  });

  test("a lock written under another npm major than the account's is not pushed: the account keeps its own", () => {
    const base = { ...localProfile(defaultProfile()), lock: OTHER_LOCK, npmMajor: 11 };
    expect(pushBody(defaultProfile(), base, { lock: LOCK, npmMajor: 10 })).toMatchObject({
      lock: OTHER_LOCK,
      npmMajor: 11,
    });
  });
});
