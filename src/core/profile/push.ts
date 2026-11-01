import { isDeepStrictEqual } from 'node:util';
import {
  pushProfile,
  type CloudFetch,
  type CloudProfile,
  type JsonObject,
  type ProfileWrite,
} from './cloud.js';
import { toDocument, type Profile } from './schema.js';

// The change on a base, installed and loaded; called again on the newer document after a 412.
export type Apply = (base: CloudProfile) => Promise<ProfileWrite>;

export interface Pushed {
  etag: string;
  // false when the account already held exactly this document.
  pushed: boolean;
}

export interface LockPair {
  lock: JsonObject | null;
  npmMajor: number | null;
}

type Attempt =
  | ({ kind: 'done' } & Pushed)
  | { kind: 'conflict'; body: ProfileWrite; current: CloudProfile | null };

// A lock from another npm major than the account's is not pushed: the account keeps its own.
export const pushBody = (next: Profile, base: CloudProfile, local: LockPair): ProfileWrite => {
  const other = base.npmMajor !== null && local.npmMajor !== null;
  const keep = other && base.npmMajor !== local.npmMajor;
  const pair = keep ? { lock: base.lock, npmMajor: base.npmMajor } : local;
  return { version: next.version, profile: toDocument(next), ...pair };
};

const refuseNewer = (base: CloudProfile): void => {
  if (!base.readOnly) return;
  const newer = `version ${base.profile.version}, newer than this CLI understands`;
  throw new Error(`the profile in your account is ${newer}; it was not changed`);
};

const attemptOn = async (fetch: CloudFetch, base: CloudProfile, apply: Apply): Promise<Attempt> => {
  refuseNewer(base);
  const body = await apply(base);
  const same = base.etag !== null && isDeepStrictEqual(body.profile, toDocument(base.profile));
  if (same && base.etag !== null) return { kind: 'done', etag: base.etag, pushed: false };
  const res = await pushProfile(fetch, body, base.etag);
  if (res.kind === 'stored') return { kind: 'done', etag: res.etag, pushed: true };
  return { kind: 'conflict', body, current: res.current };
};

const shown = (doc: JsonObject): string => JSON.stringify(doc, null, 2);

const conflictError = (body: ProfileWrite, current: CloudProfile | null): Error => {
  const theirs = current
    ? `in your account (etag ${current.etag}):\n${shown(toDocument(current.profile))}`
    : 'in your account: none';
  return new Error(
    'not pushed: the profile in your account changed again while this change was pushed\n' +
      `yours:\n${shown(body.profile)}\n${theirs}`
  );
};

// On a 412 the change is replayed once on the account's document; a second 412 shows both.
export const pushWithReplay = async (
  fetch: CloudFetch,
  base: CloudProfile,
  apply: Apply
): Promise<Pushed> => {
  const first = await attemptOn(fetch, base, apply);
  if (first.kind === 'done') return { etag: first.etag, pushed: first.pushed };
  const second = await attemptOn(fetch, first.current ?? { ...base, etag: null }, apply);
  if (second.kind === 'done') return { etag: second.etag, pushed: second.pushed };
  throw conflictError(second.body, second.current);
};
