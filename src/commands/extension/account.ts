import { type Account, type CloudFetch } from '../../core/profile/cloud.js';
import { authedFetch } from '../../lib/auth/api.js';
import { resolveAuth } from '../../lib/auth/credentials.js';
import { credentialLinks, detectEnvMismatch } from '../../lib/auth/env-match.js';
import { introspectToken } from '../../lib/auth/introspect.js';
import { platformFetch } from '../../lib/auth/platform-pat.js';
import { discoverTarget } from '../../lib/net/discovery.js';
import { apiOrigin, siteFqdn } from '../../lib/net/origins.js';

// The account seam: null when signed out, or signed in to another environment than the target.
export type AccountOf = (opts?: { token?: string }) => Promise<Account | null>;

const CLIENT = { 'x-client-type': 'cli' };

// Read before any extension loads: the token is captured here, the fetch at CLI start.
export const signedInAccount: AccountOf = async (opts = {}) => {
  const auth = resolveAuth(opts);
  const fqdn = siteFqdn();
  if (auth === null) return null;
  const found = () => discoverTarget(fqdn);
  // Discovery is asked only when the derived issuer differs from the credential's.
  const derived = detectEnvMismatch(auth, fqdn) !== null;
  if (derived && detectEnvMismatch(auth, fqdn, (await found()).links.auth) !== null) return null;
  const target = credentialLinks(auth);
  const to =
    (base: () => Promise<string> | string): CloudFetch =>
    async (path, { headers, timeoutMs, ...init } = {}) =>
      authedFetch(
        auth,
        target,
        `${await base()}${path}`,
        { ...init, headers: { ...CLIENT, ...headers } },
        { timeoutMs }
      );
  const platform = async () => (await found()).platform.url;
  const fetch = to(() => apiOrigin(fqdn));
  const machines: CloudFetch = async (path, { headers, timeoutMs, ...init } = {}) => {
    const sent = { ...init, headers: { ...CLIENT, ...headers } };
    return platformFetch(auth, target, await found(), path, sent, { timeoutMs });
  };
  const id = () =>
    introspectToken(auth, target).then(
      (s) => s.userId ?? null,
      () => null
    );
  return { fetch, machines, platform, id };
};
