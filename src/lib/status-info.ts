import { AuthRequiredError, introspectToken } from './api.js';
import { type AuthState } from './config.js';
import { environment, links, type Env } from './origins.js';
import { checkForUpdate, type UpdateInfo } from './update-check.js';
import { VERSION } from '../utils/version.js';

export interface StatusReport {
  version: string;
  fqdn: string;
  env: Env;
  auth: { signedIn: boolean; tokenExpiresAt?: string; note?: string };
  endpoint: { url: string; reachable: boolean };
  update: UpdateInfo;
}

const checkEndpoint = async (apiUrl: string): Promise<boolean> => {
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

export const gatherStatus = async (auth: AuthState | null, fqdn: string): Promise<StatusReport> => {
  const target = links(fqdn);
  // Reachability + update check share the api base and don't depend on each other - run
  // them together so `status` stays snappy.
  const [reachable, update] = await Promise.all([
    checkEndpoint(target.api),
    checkForUpdate(target.api, VERSION),
  ]);
  const report: StatusReport = {
    version: VERSION,
    fqdn,
    env: environment(fqdn),
    auth: { signedIn: false, note: 'not signed in - run: agentage setup' },
    endpoint: { url: target.api, reachable },
    update,
  };
  if (!auth) return report;
  try {
    const session = await introspectToken(auth, target);
    report.auth = { signedIn: true, tokenExpiresAt: session.expiresAt };
  } catch (err) {
    report.auth =
      err instanceof AuthRequiredError
        ? { signedIn: false, note: 'session expired - run: agentage setup' }
        : {
            signedIn: false,
            note: `could not verify session: ${err instanceof Error ? err.message : String(err)}`,
          };
  }
  return report;
};
