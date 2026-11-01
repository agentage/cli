// The account's profile at /v1/profile: one ETag over the profile, npm's lock and the npm major.
import { isRecord, json, type Reply } from './http.js';
import { mintEtag, type StubAccount, type StubProfile } from './state.js';

export interface Preconditions {
  ifMatch?: string;
  ifNoneMatch?: string;
}

// The house error envelope.
export const failure = (status: number, code: string, message: string, details?: unknown): Reply =>
  json(status, {
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });

const resource = ({ etag: _etag, ...stored }: StubProfile) => stored;

const served = (status: number, stored: StubProfile): Reply => ({
  ...json(status, { success: true, data: resource(stored), meta: { etag: stored.etag } }),
  headers: { etag: stored.etag },
});

export const getProfile = (account: StubAccount, ifNoneMatch?: string): Reply => {
  const stored = account.profile;
  if (!stored) return failure(404, 'PROFILE_NOT_FOUND', 'no profile for this account');
  if (ifNoneMatch === stored.etag) return { status: 304, headers: { etag: stored.etag } };
  return served(200, stored);
};

const isNpmMajor = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 10);

// The checks of the contract a client can trip: the shape, the version pair, the lock pair.
const writeProblem = (body: unknown): string | null => {
  if (!isRecord(body) || !isRecord(body['profile']) || !Number.isInteger(body['version']))
    return 'the body is { version, profile, lock, npmMajor }';
  if (body['profile']['version'] !== body['version']) return 'profile.version must equal version';
  const { lock, npmMajor } = body;
  const paired = (lock === null) === (npmMajor === null) && (lock === null || isRecord(lock));
  return paired && isNpmMajor(npmMajor) ? null : 'lock and npmMajor are both null or both set';
};

export const storeProfile = (account: StubAccount, write: Record<string, unknown>): StubProfile => {
  account.profile = {
    version: write['version'] as number,
    profile: write['profile'] as Record<string, unknown>,
    lock: (write['lock'] ?? null) as Record<string, unknown> | null,
    npmMajor: (write['npmMajor'] ?? null) as number | null,
    updatedAt: new Date().toISOString(),
    etag: mintEtag(),
  };
  return account.profile;
};

const conflict = (account: StubAccount, sent: string): Reply =>
  failure(
    412,
    'PRECONDITION_FAILED',
    `profile changed since ${sent}; replay on the current document`,
    {
      etag: account.profile?.etag ?? null,
      current: account.profile ? resource(account.profile) : null,
    }
  );

// A push another machine landed first, when the test queued one.
const otherPush = (account: StubAccount): void => {
  const edit = account.conflicts.shift();
  if (edit && account.profile)
    storeProfile(account, { ...account.profile, profile: edit(account.profile.profile) });
};

const preconditionProblem = ({ ifMatch, ifNoneMatch }: Preconditions): Reply | null => {
  if (ifMatch !== undefined && ifNoneMatch !== undefined)
    return failure(400, 'BAD_REQUEST', 'send exactly one of If-Match: <etag> or If-None-Match: *');
  if (ifMatch === undefined && ifNoneMatch !== '*')
    return failure(428, 'PRECONDITION_REQUIRED', 'send If-Match: <etag> or If-None-Match: *');
  return null;
};

export const putProfile = (account: StubAccount, pre: Preconditions, body: unknown): Reply => {
  const refused = preconditionProblem(pre);
  if (refused) return refused;
  const problem = writeProblem(body);
  if (problem)
    return failure(400, 'INVALID_PROFILE', problem, [{ field: 'body', message: problem }]);
  otherPush(account);
  const create = pre.ifMatch === undefined;
  const matches = create ? account.profile === null : account.profile?.etag === pre.ifMatch;
  if (!matches) return conflict(account, pre.ifMatch ?? '*');
  return served(create ? 201 : 200, storeProfile(account, body as Record<string, unknown>));
};
