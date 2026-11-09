import { type Account, type CloudFetch } from '../../core/profile/cloud.js';
import { authedFetch } from '../../lib/auth/api.js';
import { resolveAuth } from '../../lib/auth/credentials.js';
import { detectEnvMismatch } from '../../lib/auth/env-match.js';
import { introspectToken } from '../../lib/auth/introspect.js';
import { discoverPlatform } from '../../lib/net/discovery.js';
import { apiOrigin, links, siteFqdn } from '../../lib/net/origins.js';

// The account seam: null when signed out, or signed in to another environment than the target.
export type AccountOf = (opts?: { token?: string }) => Account | null;

const CLIENT = { 'x-client-type': 'cli' };

// Read before any extension loads: the token is captured here, the fetch at CLI start.
export const signedInAccount: AccountOf = (opts = {}) => {
  const auth = resolveAuth(opts);
  const fqdn = siteFqdn();
  if (auth === null || detectEnvMismatch(auth, fqdn) !== null) return null;
  const target = links(fqdn);
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
  let found: Promise<string> | undefined;
  const platform = () => (found ??= discoverPlatform(fqdn));
  const fetch = to(() => apiOrigin(fqdn));
  const machines = to(async () => `${await platform()}/api/v1/machines`);
  const id = () =>
    introspectToken(auth, target).then(
      (s) => s.userId ?? null,
      () => null
    );
  return { fetch, machines, platform, id };
};
