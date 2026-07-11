import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthState } from '../fs/config.js';
import {
  assertPatShape,
  isPatAuth,
  isPatShape,
  patAuthState,
  rawPatToken,
  resolveAuth,
  TOKEN_ENV_VAR,
} from './credentials.js';

const stored: AuthState = {
  siteFqdn: 'dev.agentage.io',
  clientId: 'c1',
  tokens: { accessToken: 'oauth-access', refreshToken: 'rt' },
};

const readStored = (): AuthState | null => stored;

describe('isPatShape', () => {
  it('accepts an aga_ token with a non-empty tail', () => {
    expect(isPatShape('aga_abc123')).toBe(true);
  });

  it('rejects a bare prefix, a wrong prefix, and an empty string', () => {
    expect(isPatShape('aga_')).toBe(false);
    expect(isPatShape('sk_abc')).toBe(false);
    expect(isPatShape('')).toBe(false);
  });
});

describe('assertPatShape', () => {
  it('trims and returns a valid token', () => {
    expect(assertPatShape('  aga_abc  ')).toBe('aga_abc');
  });

  it('throws a dashboard-pointing message on a malformed token', () => {
    expect(() => assertPatShape('nope')).toThrow(/personal access token starting with "aga_"/);
  });
});

describe('rawPatToken (flag > env)', () => {
  const original = process.env[TOKEN_ENV_VAR];
  beforeEach(() => delete process.env[TOKEN_ENV_VAR]);
  afterEach(() => {
    if (original === undefined) delete process.env[TOKEN_ENV_VAR];
    else process.env[TOKEN_ENV_VAR] = original;
  });

  it('prefers the flag over the env var', () => {
    process.env[TOKEN_ENV_VAR] = 'aga_from_env';
    expect(rawPatToken({ token: 'aga_from_flag' })).toBe('aga_from_flag');
  });

  it('falls back to the env var when no flag is given', () => {
    process.env[TOKEN_ENV_VAR] = 'aga_from_env';
    expect(rawPatToken()).toBe('aga_from_env');
  });

  it('treats an empty flag or empty/whitespace env value as unset', () => {
    process.env[TOKEN_ENV_VAR] = '   ';
    expect(rawPatToken({ token: '  ' })).toBeUndefined();
    delete process.env[TOKEN_ENV_VAR];
    expect(rawPatToken()).toBeUndefined();
  });
});

describe('patAuthState', () => {
  it('synthesizes a pat-marked, refresh-less credential pinned to the target fqdn', () => {
    const auth = patAuthState('aga_tok', 'dev.agentage.io');
    expect(auth.kind).toBe('pat');
    expect(auth.tokens.accessToken).toBe('aga_tok');
    expect(auth.tokens.refreshToken).toBeUndefined();
    expect(auth.siteFqdn).toBe('dev.agentage.io');
    expect(isPatAuth(auth)).toBe(true);
    expect(isPatAuth(stored)).toBe(false);
  });
});

describe('resolveAuth (precedence flag > env > stored OAuth)', () => {
  const original = process.env[TOKEN_ENV_VAR];
  beforeEach(() => delete process.env[TOKEN_ENV_VAR]);
  afterEach(() => {
    if (original === undefined) delete process.env[TOKEN_ENV_VAR];
    else process.env[TOKEN_ENV_VAR] = original;
  });

  it('uses the flag PAT over the env PAT and the stored OAuth session', () => {
    process.env[TOKEN_ENV_VAR] = 'aga_env';
    const auth = resolveAuth({ token: 'aga_flag' }, readStored);
    expect(auth?.kind).toBe('pat');
    expect(auth?.tokens.accessToken).toBe('aga_flag');
  });

  it('uses the env PAT over the stored OAuth session when no flag', () => {
    process.env[TOKEN_ENV_VAR] = 'aga_env';
    const auth = resolveAuth({}, readStored);
    expect(auth?.kind).toBe('pat');
    expect(auth?.tokens.accessToken).toBe('aga_env');
  });

  it('falls back to the stored OAuth session when no PAT is present', () => {
    const auth = resolveAuth({}, readStored);
    expect(auth?.kind).toBeUndefined();
    expect(auth?.tokens.accessToken).toBe('oauth-access');
  });

  it('returns null when no PAT and no stored session', () => {
    expect(resolveAuth({}, () => null)).toBeNull();
  });
});
