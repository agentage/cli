import { isRecord } from '../fs/json-file.js';
import { mutateAuth, type AuthState, type PlatformPat } from '../fs/config.js';
import { cliFetch, type CliFetchOptions, type CliRequestInit } from '../net/fetch.js';
import { type Links } from '../net/origins.js';
import { authedFetch } from './api.js';

const DAY_MS = 86_400_000;
const MINT = { label: 'agentage cli', format: 'jwt', scopes: ['platform:read', 'platform:write'] };
const BODY = JSON.stringify({ ...MINT, expiresInDays: 30 });

const isPlatformPat = (v: unknown): v is PlatformPat =>
  isRecord(v) && ['id', 'token', 'expiresAt'].every((k) => typeof v[k] === 'string');

export const storedPlatformPat = (auth: AuthState, issuer: string): PlatformPat | null => {
  const pat = auth.platformPats?.[issuer];
  return isPlatformPat(pat) ? pat : null;
};

const mint = async (auth: AuthState, links: Links, opts: CliFetchOptions): Promise<PlatformPat> => {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: BODY };
  const res = await authedFetch(auth, links, `${links.auth}/account/pat`, init, opts);
  const body = res.status === 201 ? ((await res.json()) as unknown) : await res.body?.cancel();
  const data = isRecord(body) ? body['data'] : undefined;
  if (!isPlatformPat(data)) throw new Error(`platform token: mint answered ${res.status}`);
  return { id: data.id, token: data.token, expiresAt: data.expiresAt };
};

// Only the session that minted it keeps it: a sign-out or another sign-in in between drops it.
const keep = (auth: AuthState, issuer: string, pat: PlatformPat) =>
  mutateAuth((current) => {
    if (!current || current.clientId !== auth.clientId) return null;
    current.platformPats = { ...current.platformPats, [issuer]: pat };
    return current;
  });

const revoke = (auth: AuthState, links: Links, id: string): Promise<void> =>
  authedFetch(auth, links, `${links.auth}/account/pat/${id}`, { method: 'DELETE' }).then(
    (res) => res.body?.cancel(),
    () => undefined
  );

// The stored token while it has over a day left, else a new one; the replaced one is revoked.
const tokenFor = async (auth: AuthState, links: Links, renew: boolean, opts: CliFetchOptions) => {
  const old = storedPlatformPat(auth, links.auth);
  if (!renew && old && Date.parse(old.expiresAt) - Date.now() > DAY_MS) return old.token;
  const pat = await mint(auth, links, opts);
  auth.platformPats = { ...auth.platformPats, [links.auth]: pat };
  await keep(auth, links.auth, pat);
  if (old) await revoke(auth, links, old.id);
  return pat.token;
};

// A platform call with the platform token; a 401 mints a new one and retries once.
export const platformFetch = async (
  auth: AuthState,
  links: Links,
  url: string,
  init: CliRequestInit = {},
  opts: CliFetchOptions = {}
): Promise<Response> => {
  const call = async (renew: boolean) => {
    const bearer = `Bearer ${await tokenFor(auth, links, renew, opts)}`;
    return cliFetch(url, { ...init, headers: { ...init.headers, authorization: bearer } }, opts);
  };
  const res = await call(false);
  if (res.status !== 401) return res;
  await res.body?.cancel();
  return call(true);
};
