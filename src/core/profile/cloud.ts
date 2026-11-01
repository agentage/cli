import { isRecord } from '../../lib/fs/json-file.js';
import { parseProfile, type Profile } from './schema.js';

// One resource per account: the profile, npm's lock and the npm major that wrote it, one ETag.
export const PROFILE_PATH = '/v1/profile';

export type JsonObject = Record<string, unknown>;

export interface CloudInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

// The account's API: a path under the API origin in, the Response out; the bearer is the caller's.
export type CloudFetch = (path: string, init?: CloudInit) => Promise<Response>;

// The signed-in account as commands reach it.
export interface Account {
  fetch: CloudFetch;
  // The account id (the OAuth subject); null when it could not be verified just now.
  id: () => Promise<string | null>;
}

// The PUT body.
export interface ProfileWrite {
  version: number;
  profile: JsonObject;
  lock: JsonObject | null;
  npmMajor: number | null;
}

// The account's profile, parsed; `etag` is null while the account has none (a push creates it).
export interface CloudProfile {
  profile: Profile;
  readOnly: boolean;
  lock: JsonObject | null;
  npmMajor: number | null;
  etag: string | null;
}

export type Pull =
  | { kind: 'current' }
  | { kind: 'found'; doc: CloudProfile & { etag: string } }
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: string };

export type Push =
  { kind: 'stored'; etag: string } | { kind: 'conflict'; current: CloudProfile | null };

// The account answered a push with something other than a new ETag or a 412.
export class NotPushedError extends Error {}

// A profile that is not in the account yet: pushing it creates it.
export const localProfile = (profile: Profile): CloudProfile => ({
  profile,
  readOnly: profile.version > 1,
  lock: null,
  npmMajor: null,
  etag: null,
});

// What a request ended with: the Response, or why there was none.
const attempt = async (request: () => Promise<Response>): Promise<Response | string> => {
  try {
    return await request();
  } catch (err) {
    return (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
  }
};

const bodyOf = async (res: Response): Promise<unknown> => {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
};

// The code of the house error envelope, e.g. PROFILE_NOT_FOUND; null without one. Reads the body.
export const errorCode = async (res: Response): Promise<string | null> => {
  const body = await bodyOf(res);
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  return typeof error['code'] === 'string' ? error['code'] : null;
};

// e.g. "503 AUTH_UNAVAILABLE": the status, and the envelope's code when there is one.
const failureOf = async (res: Response): Promise<string> => {
  const code = await errorCode(res);
  return code === null ? `${res.status}` : `${res.status} ${code}`;
};

const isMajor = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value));

// A served resource and its etag, parsed; a string says what is wrong with it.
const resourceOf = (data: unknown, etag: unknown): (CloudProfile & { etag: string }) | string => {
  if (!isRecord(data) || typeof etag !== 'string') return 'unexpected answer';
  const { lock, npmMajor } = data;
  if (!(lock === null || isRecord(lock)) || !isMajor(npmMajor)) return 'unexpected answer';
  const parsed = parseProfile(data['profile']);
  if (!parsed.ok) return `the profile in your account is invalid: ${parsed.errors.join('; ')}`;
  return { profile: parsed.profile, readOnly: parsed.readOnly, lock, npmMajor, etag };
};

// meta.etag equals the ETag header on a 2xx; either will do.
const etagOf = (body: unknown, header: string | null): unknown => {
  const meta = isRecord(body) && isRecord(body['meta']) ? body['meta'] : {};
  return meta['etag'] ?? header;
};

const served = (body: unknown, header: string | null) =>
  resourceOf(isRecord(body) ? body['data'] : null, etagOf(body, header));

const unavailable = (reason: string): Pull => ({ kind: 'unavailable', reason });

const NO_PROFILE = '404 PROFILE_NOT_FOUND';

// GET, conditional on the local copy's etag: 304 keeps it, 200 replaces it, 404 means none yet.
export const pullProfile = async (
  fetch: CloudFetch,
  etag: string | null,
  timeoutMs?: number
): Promise<Pull> => {
  const headers: Record<string, string> = etag === null ? {} : { 'if-none-match': etag };
  const res = await attempt(() => fetch(PROFILE_PATH, { headers, timeoutMs }));
  if (typeof res === 'string') return unavailable(res);
  if (res.status === 304) return { kind: 'current' };
  if (res.status !== 200) {
    // Any other 404 is an API without the profile route, not an account without a profile.
    const failure = await failureOf(res);
    return failure === NO_PROFILE ? { kind: 'none' } : unavailable(failure);
  }
  const doc = served(await bodyOf(res), res.headers.get('etag'));
  return typeof doc === 'string' ? unavailable(doc) : { kind: 'found', doc };
};

// A 412 carries the account's current resource and etag (both null when it holds none).
const conflictOf = (body: unknown): Push => {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  const details = isRecord(error['details']) ? error['details'] : {};
  if (details['current'] === null) return { kind: 'conflict', current: null };
  const current = resourceOf(details['current'], details['etag']);
  if (typeof current === 'string')
    throw new NotPushedError(`not pushed to your account (412: ${current})`);
  return { kind: 'conflict', current };
};

const notPushed = (reason: string): NotPushedError =>
  new NotPushedError(`not pushed to your account (${reason})`);

// PUT the whole resource: If-Match replaces the copy it was pulled at, no etag creates it.
export const pushProfile = async (
  fetch: CloudFetch,
  body: ProfileWrite,
  etag: string | null
): Promise<Push> => {
  const precondition: Record<string, string> =
    etag === null ? { 'if-none-match': '*' } : { 'if-match': etag };
  const headers = { 'content-type': 'application/json', ...precondition };
  const init = { method: 'PUT', headers, body: JSON.stringify(body) };
  const res = await attempt(() => fetch(PROFILE_PATH, init));
  if (typeof res === 'string') throw notPushed(res);
  if (res.status === 412) return conflictOf(await bodyOf(res));
  if (res.status !== 200 && res.status !== 201) throw notPushed(await failureOf(res));
  const stored = etagOf(await bodyOf(res), res.headers.get('etag'));
  if (typeof stored !== 'string') throw notPushed('unexpected answer');
  return { kind: 'stored', etag: stored };
};
