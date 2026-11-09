import { type AuthState, type PlatformPat } from '../fs/config.js';
import { type Target } from '../net/discovery.js';
import { cliFetch, type CliFetchOptions, type CliRequestInit } from '../net/fetch.js';
import { type Links } from '../net/origins.js';
import { VERSION } from '../../utils/version.js';
import { authedFetch, updateSession } from './api.js';

const DAY_MS = 86_400_000;
const MINT = JSON.stringify({
  label: 'agentage cli',
  format: 'jwt',
  scopes: ['platform:read', 'platform:write'],
  expiresInDays: 30,
});

const withBearer = (init: CliRequestInit, token: string): CliRequestInit => ({
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${token}` },
});

const revokePat = (bearer: string, issuer: string, id: string): Promise<void> =>
  cliFetch(`${issuer}/account/pat/${id}`, withBearer({ method: 'DELETE' }, bearer), {
    timeoutMs: 5_000,
  }).then(
    (res) => res.body?.cancel(),
    () => undefined
  );

// Best-effort, before the session that minted them is dropped or replaced.
export const revokePlatformPats = async (auth: AuthState, bearer = auth.tokens.accessToken) => {
  const pats = Object.entries(auth.platformPats ?? {});
  await Promise.all(pats.map(([issuer, pat]) => revokePat(bearer, issuer, pat.id)));
};

// Once refused, a run stops asking: one line, no second mint, no fallback to the OAuth bearer.
const refused = new Map<string, Error>();
const refuse = (issuer: string, reason: string): Error => {
  const err = refused.get(issuer) ?? new Error(reason);
  if (!refused.has(issuer)) console.error(reason);
  refused.set(issuer, err);
  return err;
};

const mint = async (auth: AuthState, links: Links, opts: CliFetchOptions) => {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: MINT };
  const res = await authedFetch(auth, links, `${links.auth}/account/pat`, init, opts);
  if (res.status === 201) return ((await res.json()) as { data: PlatformPat }).data;
  await res.body?.cancel();
  const reason = `platform token refused (${res.status}): auth may be older than ${VERSION}`;
  throw refuse(links.auth, reason);
};

// The stored token while it has over a day left, else a new one; the old one is revoked unawaited.
const tokenFor = async (auth: AuthState, links: Links, renew: boolean, opts: CliFetchOptions) => {
  const old = auth.platformPats?.[links.auth];
  if (!renew && old && Date.parse(old.expiresAt) - Date.now() > DAY_MS) return null;
  const { id, token, expiresAt } = await mint(auth, links, opts);
  const pats = { ...auth.platformPats, [links.auth]: { id, token, expiresAt } };
  auth.platformPats = pats;
  await updateSession(auth.clientId, (current) => void (current.platformPats = pats));
  if (old) void revokePat(auth.tokens.accessToken, links.auth, old.id);
  return token;
};

// A discovered platform takes only a JWT PAT the session mints; an env PAT goes as is.
export const platformFetch = async (
  auth: AuthState,
  links: Links,
  found: Target,
  path: string,
  init: CliRequestInit,
  opts: CliFetchOptions
): Promise<Response> => {
  const url = `${found.platform.machines}${path}`;
  if (!found.discovered || auth.kind === 'pat') return authedFetch(auth, links, url, init, opts);
  if (found.links.auth !== links.auth)
    throw refuse(links.auth, `platform token: the site's issuer is ${found.links.auth}`);
  const prior = refused.get(links.auth);
  if (prior) throw prior;
  const call = async (renew: boolean) => {
    const minted = await tokenFor(auth, links, renew, opts);
    const token = minted ?? auth.platformPats![links.auth]!.token;
    return { minted, res: await cliFetch(url, withBearer(init, token), opts) };
  };
  let { minted, res } = await call(false);
  if (res.status === 401 && minted === null) {
    await res.body?.cancel();
    ({ minted, res } = await call(true));
  }
  if (res.status !== 401) return res;
  await res.body?.cancel();
  throw refuse(links.auth, 'platform token refused (401) by the platform');
};
