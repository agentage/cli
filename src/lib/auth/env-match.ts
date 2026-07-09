import { type AuthState } from '../fs/config.js';
import { environment, normalizeFqdn, type Env } from '../net/origins.js';

export interface AuthEnvMismatch {
  credentialFqdn: string;
  credentialEnv: Env;
  targetFqdn: string;
  targetEnv: Env;
}

// The stored credential belongs to the environment it was issued for (auth.siteFqdn); the CLI's
// current target comes from AGENTAGE_SITE_FQDN (production default). Introspecting a dev credential
// against production rejects it and misreads as "expired" - so detect the mismatch by normalized
// fqdn BEFORE any introspection. Returns null when the credential matches the current target.
export const detectEnvMismatch = (auth: AuthState, targetFqdn: string): AuthEnvMismatch | null => {
  const credentialFqdn = normalizeFqdn(auth.siteFqdn);
  const target = normalizeFqdn(targetFqdn);
  if (credentialFqdn === target) return null;
  return {
    credentialFqdn,
    credentialEnv: environment(credentialFqdn),
    targetFqdn: target,
    targetEnv: environment(target),
  };
};
