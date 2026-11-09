import { type AuthState } from '../fs/config.js';
import { environment, links, normalizeFqdn, type Env, type Links } from '../net/origins.js';

export interface AuthEnvMismatch {
  credentialFqdn: string;
  credentialEnv: Env;
  targetFqdn: string;
  targetEnv: Env;
}

// A credential stored before the issuer field was kept reads as issued by auth.<its siteFqdn>.
export const credentialLinks = (auth: AuthState): Links => {
  const own = links(normalizeFqdn(auth.siteFqdn));
  return { ...own, auth: auth.issuer ?? own.auth };
};

// A credential belongs to its issuer, so one session serves every target naming that issuer.
// Introspecting it against another issuer would misread as "expired": detect that first.
export const detectEnvMismatch = (
  auth: AuthState,
  targetFqdn: string,
  targetIssuer: string = links(normalizeFqdn(targetFqdn)).auth
): AuthEnvMismatch | null => {
  const credentialFqdn = normalizeFqdn(auth.siteFqdn);
  const target = normalizeFqdn(targetFqdn);
  if (auth.kind === 'pat' || credentialLinks(auth).auth === targetIssuer) return null;
  return {
    credentialFqdn,
    credentialEnv: environment(credentialFqdn),
    targetFqdn: target,
    targetEnv: environment(target),
  };
};
