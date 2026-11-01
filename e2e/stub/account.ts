/**
 * The account routes under /v1 (profile, machines): the bearer must be a live stub token; each
 * request is logged with its precondition headers and body before the route's mode applies.
 */
import { type IncomingMessage } from 'node:http';
import { parseJson, readBody, type Reply } from './http.js';
import { machinesRoute } from './machines.js';
import { failure, getProfile, putProfile } from './profile.js';
import { liveAccess, type StubRequest, type StubState } from './state.js';

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
};

const logged = async (req: IncomingMessage, entry: StubRequest): Promise<unknown> => {
  const raw = await readBody(req);
  const body = raw === '' ? undefined : parseJson(raw);
  const ifMatch = header(req, 'if-match');
  const ifNoneMatch = header(req, 'if-none-match');
  Object.assign(entry, {
    ...(ifMatch === undefined ? {} : { ifMatch }),
    ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
    ...(body === undefined ? {} : { body }),
  });
  return body;
};

const profileRoute = (state: StubState, entry: StubRequest, body: unknown): Reply => {
  const { account } = state;
  if (entry.method === 'GET') return getProfile(account, entry.ifNoneMatch);
  if (entry.method === 'PUT') return putProfile(account, entry, body);
  return failure(404, 'NOT_FOUND', `${entry.method} ${entry.path}`);
};

const NEVER = new Promise<Reply>(() => undefined);

export const accountRoute = async (
  state: StubState,
  req: IncomingMessage,
  entry: StubRequest
): Promise<Reply> => {
  const body = await logged(req, entry);
  const profile = entry.path === '/v1/profile';
  const mode = profile ? state.account.modes.profile : state.account.modes.machines;
  if (mode === 'hang') return NEVER;
  if (mode === '503') return failure(503, 'INTERNAL', 'temporarily unavailable');
  const bearer = (header(req, 'authorization') ?? '').replace(/^Bearer /i, '');
  if (!liveAccess(state, bearer)) return failure(401, 'UNAUTHORIZED', 'Invalid or expired session');
  if (profile) return profileRoute(state, entry, body);
  const version = header(req, 'x-agentage-cli-version');
  return machinesRoute(state.account, entry.method, entry.path, body, version);
};
