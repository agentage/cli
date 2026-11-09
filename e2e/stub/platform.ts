/**
 * A discovered platform (off until `state.platform.on`): /.well-known/agentage.json names this
 * origin as issuer and platform, /account/pat mints JWT PATs for a live OAuth bearer, and
 * /api/v1/machines takes only a live one of those, as the platform on next does.
 */
import { type IncomingMessage } from 'node:http';
import { json, parseJson, readBody, type Reply } from './http.js';
import { machinesRoute } from './machines.js';
import { failure } from './profile.js';
import { liveAccess, mint, type StubRequest, type StubState } from './state.js';

const bearerOf = (req: IncomingMessage): string =>
  String(req.headers.authorization ?? '').replace(/^Bearer /i, '');

export const discovery = (state: StubState, req: IncomingMessage): Reply => {
  if (!state.platform.on) return json(404, { error: 'not_found' });
  const origin = `http://${req.headers.host}`;
  return json(200, { issuer: origin, platform: origin });
};

const mintPat = (state: StubState, body: unknown): Reply => {
  const { pats, expiresInS } = state.platform;
  const id = `tok_${pats.length + 1}`;
  const expiresAt = new Date(Date.now() + expiresInS * 1000).toISOString();
  pats.push({ id, token: mint('aga_jwt'), expiresAt, revoked: false, body });
  const { token } = pats.at(-1)!;
  return json(201, { success: true, data: { id, token, label: 'x', scopes: [], expiresAt } });
};

// POST /account/pat and DELETE /account/pat/<id>, with the OAuth bearer.
export const patRoute = async (state: StubState, req: IncomingMessage, entry: StubRequest) => {
  if (!liveAccess(state, bearerOf(req))) return failure(401, 'UNAUTHORIZED', 'Sign in required');
  if (entry.method === 'POST') return mintPat(state, parseJson(await readBody(req)));
  const pat = state.platform.pats.find((p) => entry.path.endsWith(`/${p.id}`));
  if (!pat) return failure(404, 'NOT_FOUND', 'Token not found');
  pat.revoked = true;
  return json(200, { success: true, data: { id: pat.id, revoked: true } });
};

export const platformRoute = async (state: StubState, req: IncomingMessage, entry: StubRequest) => {
  const raw = await readBody(req);
  const body = raw === '' ? undefined : parseJson(raw);
  if (body !== undefined) entry.body = body;
  const live = (p: { token: string; revoked: boolean; expiresAt: string }) =>
    p.token === bearerOf(req) && !p.revoked && Date.parse(p.expiresAt) > Date.now();
  if (!state.platform.pats.some(live)) return failure(401, 'UNAUTHORIZED', 'a platform token');
  return machinesRoute(state.account, entry.method, entry.path.slice(4), body);
};
