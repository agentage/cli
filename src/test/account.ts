/**
 * An account in memory for the unit tests: `fetch` answers /v1/profile and /v1/machines the way
 * the account routes do (an ETag per write, 304, 404, 412 carrying the current document,
 * If-None-Match: * creating) and logs every request; `fail` makes a route answer 503, fail like a
 * dead network, or time out. `account()` is the commands' `account` seam, signed in as `id`.
 */
import { type Account, type CloudFetch, type CloudInit } from '../core/profile/cloud.js';
import { type ConfigDir } from './config-dir.js';
import { npmFromFixtures } from './npm-fixtures.js';

export const PLATFORM = 'https://platform.test';

type Doc = Record<string, unknown>;

export interface FakeRequest {
  method: string;
  path: string;
  // null when the request failed before an answer.
  status: number | null;
  headers: Record<string, string>;
  body?: Doc;
  timeoutMs?: number;
}

export interface Stored {
  version: number;
  profile: Doc;
  lock: Doc | null;
  npmMajor: number | null;
  etag: string;
}

export type Failure = 503 | 'network' | 'timeout';

export interface FakeAccount {
  account: () => Account;
  fetch: CloudFetch;
  requests: FakeRequest[];
  stored: Stored | null;
  // Stores a profile as another machine's push would; returns its etag.
  store: (profile: Doc, lock?: Doc | null, npmMajor?: number | null) => string;
  // Each next PUT first meets another machine's push: one change to the stored profile.
  conflicts: ((profile: Doc) => Doc)[];
  // `method` limits it to one method, e.g. a push failing after its pull worked.
  fail: (route: 'profile' | 'machines', how: Failure, method?: string) => void;
  machines: Map<string, Doc>;
}

const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

const failure = (status: number, code: string, details?: unknown) =>
  answer(status, { success: false, error: { code, message: code.toLowerCase(), details } });

const served = (status: number, { etag, ...data }: Stored) =>
  answer(status, { success: true, data: { ...data, updatedAt: 'now' }, meta: { etag } }, { etag });

const failed = (how: Failure): Promise<Response> => {
  if (how === 503) return Promise.resolve(failure(503, 'INTERNAL'));
  const error =
    how === 'timeout'
      ? new DOMException('timed out', 'TimeoutError')
      : new TypeError('fetch failed');
  return Promise.reject(error);
};

// The account's answer to one request, or the failure `fail` set for its route.
const answering =
  (fake: FakeAccount, failures: Map<string, Failure>): CloudFetch =>
  async (path, init = {}) => {
    const request = logged(fake, path, init);
    const route = path.startsWith('/v1/profile') ? 'profile' : 'machines';
    const how = failures.get(`${route} `) ?? failures.get(`${route} ${request.method}`);
    const res = await (how === undefined ? Promise.resolve(answerTo(fake, request)) : failed(how));
    request.status = res.status;
    return res;
  };

export const fakeAccount = (id: string | null = 'user_1'): FakeAccount => {
  let count = 0;
  const failures = new Map<string, Failure>();
  const fake: FakeAccount = {
    account: () => ({
      fetch: fake.fetch,
      machines: (path, init) => fake.fetch(`/v1/machines${path}`, init),
      platform: async () => PLATFORM,
      id: async () => id,
    }),
    requests: [],
    stored: null,
    conflicts: [],
    machines: new Map(),
    store: (profile, lock = null, npmMajor = null) => {
      const etag = `"etag-${String(++count).padStart(4, '0')}"`;
      fake.stored = { version: 1, profile, lock, npmMajor, etag };
      return etag;
    },
    fail: (route, how, method = '') => void failures.set(`${route} ${method}`, how),
    fetch: (path, init) => answering(fake, failures)(path, init),
  };
  return fake;
};

const logged = (fake: FakeAccount, path: string, init: CloudInit): FakeRequest => {
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  const body = init.body === undefined ? undefined : (JSON.parse(init.body) as Doc);
  const request = {
    method: init.method ?? 'GET',
    path,
    status: null,
    headers,
    body,
    timeoutMs: init.timeoutMs,
  };
  fake.requests.push(request);
  return request;
};

const answerTo = (fake: FakeAccount, r: FakeRequest): Response => {
  if (r.path === '/v1/profile')
    return r.method === 'GET' ? getProfile(fake, r) : putProfile(fake, r);
  const [, , , id, action] = r.path.split('/');
  const known = id !== undefined && fake.machines.has(id);
  if (action === 'seen') return known ? answer(204) : failure(404, 'MACHINE_NOT_FOUND');
  if (r.method === 'PUT' && id) return putMachine(fake, id, r.body ?? {});
  if (!known || !id) return failure(404, 'MACHINE_NOT_FOUND');
  fake.machines.set(id, { ...fake.machines.get(id), ...r.body });
  return answer(200, { success: true, data: fake.machines.get(id) });
};

const putMachine = (fake: FakeAccount, id: string, body: Doc): Response => {
  const known = fake.machines.get(id);
  fake.machines.set(id, { ...body, name: known?.['name'] ?? body['name'] });
  return answer(known ? 200 : 201, { success: true, data: fake.machines.get(id) });
};

const getProfile = (fake: FakeAccount, r: FakeRequest): Response => {
  if (!fake.stored) return failure(404, 'PROFILE_NOT_FOUND');
  if (r.headers['if-none-match'] === fake.stored.etag) return answer(304);
  return served(200, fake.stored);
};

const conflict = ({ stored }: FakeAccount): Response => {
  const current = stored && {
    version: stored.version,
    profile: stored.profile,
    lock: stored.lock,
    npmMajor: stored.npmMajor,
    updatedAt: 'now',
  };
  return failure(412, 'PRECONDITION_FAILED', { etag: stored?.etag ?? null, current });
};

const putProfile = (fake: FakeAccount, r: FakeRequest): Response => {
  const edit = fake.conflicts.shift();
  const { profile = { version: 1 }, lock = null, npmMajor = null } = fake.stored ?? {};
  if (edit) fake.store(edit(profile), lock, npmMajor);
  const ifMatch = r.headers['if-match'];
  const create = r.headers['if-none-match'] === '*';
  if (ifMatch === undefined && !create) return failure(428, 'PRECONDITION_REQUIRED');
  const matches = create ? fake.stored === null : fake.stored?.etag === ifMatch;
  if (!matches) return conflict(fake);
  const body = r.body as { profile: Doc; lock: Doc | null; npmMajor: number | null };
  fake.store(body.profile, body.lock, body.npmMajor);
  return served(create ? 201 : 200, fake.stored as Stored);
};

// The account seams of a machine that is not signed in, and npm 10 writing its lock.
export const noAccount = { npmMajor: async (): Promise<number> => 10, account: async () => null };

// The seams of a profile edit with `account` signed in (null: signed out); npm plays fixtures/.
export const editDeps = (account: FakeAccount | null) => ({
  ...noAccount,
  npm: npmFromFixtures,
  account: async () => account?.account() ?? null,
});

// This machine connected to the account: profile.json is its copy, at the etag returned.
export const connected = (
  dir: ConfigDir,
  account: FakeAccount,
  extensions: Record<string, string> = {}
): string => {
  dir.profile({ extensions });
  const etag = account.store(dir.json('profile.json'));
  dir.machine({}, { profileSource: 'cloud', accountId: 'user_1', profileEtag: etag });
  return etag;
};

// Registration runs alongside, so the profile's requests are read on their own.
export const profileRequests = (account: FakeAccount): FakeRequest[] =>
  account.requests.filter((r) => r.path === '/v1/profile');

// e.g. ['GET 200', 'PUT 412']
export const profileCalls = (account: FakeAccount): string[] =>
  profileRequests(account).map((r) => `${r.method} ${r.status}`);
