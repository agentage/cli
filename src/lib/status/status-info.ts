import { AuthRequiredError, introspectToken } from '../auth/api.js';
import { detectEnvMismatch, type AuthEnvMismatch } from '../auth/env-match.js';
import { type AuthState } from '../fs/config.js';
import { fetchJsonUnref } from '../net/http.js';
import { requestHeaders } from '../net/user-agent.js';
import { environment, links, type Env } from '../net/origins.js';
import { checkForUpdate, type UpdateInfo } from '../update/update-check.js';
import { VERSION } from '../../utils/version.js';

export interface StatusReport {
  version: string;
  fqdn: string;
  env: Env;
  target: { fqdn: string; env: Env; reachable: boolean };
  auth: {
    signedIn: boolean;
    tokenExpiresAt?: string;
    note?: string;
    transient?: boolean;
    // Set when authenticated via a personal access token (AGENTAGE_TOKEN / --token) rather than a
    // stored OAuth session, so the printer can label the line.
    pat?: boolean;
    // Set when the stored credential's env differs from the current target: signedIn is false and the
    // printer renders a neutral "signed in to X - CLI targets Y" line, never "session expired".
    mismatch?: AuthEnvMismatch;
  };
  endpoint: { url: string; reachable: boolean };
  update: UpdateInfo;
}

// node:https via fetchJsonUnref, not global fetch: undici's ref'd connect timer keeps the process
// alive ~10s after an aborted request on a packet-drop network, stalling `status` exit.
const checkEndpoint = async (apiUrl: string, headers: Record<string, string>): Promise<boolean> => {
  const res = await fetchJsonUnref(`${apiUrl}/health`, 3000, headers);
  return res?.ok ?? false;
};

// Host reachability, not app health: the site root answers any HTTP status (200/3xx/4xx) when the
// host is up, so any non-null response counts as reachable; only a refused/timed-out connect fails.
const checkSite = async (siteUrl: string, headers: Record<string, string>): Promise<boolean> => {
  const res = await fetchJsonUnref(siteUrl, 3000, headers);
  return res !== null;
};

// AuthRequiredError = truly expired (terminal). TransientAuthError (or any non-terminal) = a blip
// while we could not re-verify: never rendered as expired, never told to run setup, exit stays 0.
const classifyAuthError = (err: unknown): StatusReport['auth'] =>
  err instanceof AuthRequiredError
    ? { signedIn: false, note: 'session expired - run: agentage setup' }
    : { signedIn: true, transient: true, note: 'signed in (could not re-verify - temporary)' };

// A credential issued for one environment, checked against another, is not expired - it belongs
// elsewhere. Name both sides and hint the two fixes, without introspecting cross-environment.
const mismatchAuth = (m: AuthEnvMismatch): StatusReport['auth'] => ({
  signedIn: false,
  mismatch: m,
  note:
    `signed in to ${m.credentialFqdn} - CLI targets ${m.targetFqdn} (${m.targetEnv}); ` +
    `run: agentage setup to sign into ${m.targetEnv}, or set AGENTAGE_SITE_FQDN=${m.credentialFqdn}`,
});

export const gatherStatus = async (auth: AuthState | null, fqdn: string): Promise<StatusReport> => {
  const target = links(fqdn);
  const env = environment(fqdn);
  const headers = requestHeaders();
  // Endpoint reachability and the (npm-registry) update check are independent - run them
  // together so `status` stays snappy.
  const [reachable, siteReachable, update] = await Promise.all([
    checkEndpoint(target.api, headers),
    checkSite(target.site, headers),
    checkForUpdate(VERSION),
  ]);
  const report: StatusReport = {
    version: VERSION,
    fqdn,
    env,
    target: { fqdn, env, reachable: siteReachable },
    auth: { signedIn: false, note: 'not signed in - run: agentage setup' },
    endpoint: { url: target.api, reachable },
    update,
  };
  if (!auth) return report;
  const mismatch = detectEnvMismatch(auth, fqdn);
  if (mismatch) {
    report.auth = mismatchAuth(mismatch);
    return report;
  }
  // Only carry `pat: true`; omit it for OAuth so existing exact-match reports stay unchanged.
  const patFlag = auth.kind === 'pat' ? { pat: true } : {};
  try {
    const session = await introspectToken(auth, target);
    report.auth = { signedIn: true, tokenExpiresAt: session.expiresAt, ...patFlag };
  } catch (err) {
    report.auth = { ...classifyAuthError(err), ...patFlag };
  }
  return report;
};
