import { describe, expect, it } from 'vitest';
import { type AuthState } from '../fs/config.js';
import { detectEnvMismatch } from './env-match.js';

const authFor = (siteFqdn: string): AuthState => ({
  siteFqdn,
  clientId: 'c1',
  tokens: { accessToken: 'at' },
});

describe('detectEnvMismatch', () => {
  it('returns null when the credential fqdn matches the target', () => {
    expect(detectEnvMismatch(authFor('dev.agentage.io'), 'dev.agentage.io')).toBeNull();
    expect(detectEnvMismatch(authFor('agentage.io'), 'agentage.io')).toBeNull();
  });

  it('flags a dev credential against a production target', () => {
    expect(detectEnvMismatch(authFor('dev.agentage.io'), 'agentage.io')).toEqual({
      credentialFqdn: 'dev.agentage.io',
      credentialEnv: 'development',
      targetFqdn: 'agentage.io',
      targetEnv: 'production',
    });
  });

  it('flags a production credential against a dev target', () => {
    expect(detectEnvMismatch(authFor('agentage.io'), 'dev.agentage.io')).toEqual({
      credentialFqdn: 'agentage.io',
      credentialEnv: 'production',
      targetFqdn: 'dev.agentage.io',
      targetEnv: 'development',
    });
  });

  it('classifies a localhost target as development', () => {
    const m = detectEnvMismatch(authFor('agentage.io'), 'localhost:3000');
    expect(m?.targetEnv).toBe('development');
    expect(m?.credentialEnv).toBe('production');
  });

  it('normalizes scheme and trailing slash before comparing', () => {
    expect(detectEnvMismatch(authFor('https://agentage.io/'), 'agentage.io')).toBeNull();
  });
});
