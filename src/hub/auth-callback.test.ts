import { describe, it, expect, afterEach } from 'vitest';
import { startCallbackServer, getCallbackPort } from './auth-callback.js';

describe('auth-callback', () => {
  afterEach(() => {
    const srv = (startCallbackServer as { _server?: { close: () => void } })._server;
    if (srv) {
      try {
        srv.close();
      } catch {
        // already closed
      }
    }
  });

  describe('getCallbackPort', () => {
    it('returns 0 when no server started', () => {
      (startCallbackServer as { _server?: unknown })._server = undefined;
      expect(getCallbackPort()).toBe(0);
    });
  });

  describe('startCallbackServer', () => {
    it('starts server and resolves on valid callback', async () => {
      const authPromise = startCallbackServer();

      await new Promise((r) => setTimeout(r, 100));
      const port = getCallbackPort();
      expect(port).toBeGreaterThan(0);

      // Build a minimal JWT: header.payload.signature
      const payload = {
        sub: 'user-123',
        email: 'v@test.com',
        user_metadata: { full_name: 'Volodymyr', avatar_url: 'https://avatar.test/v.png' },
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const fakeJwt = `header.${encodedPayload}.signature`;

      const url = `http://localhost:${port}/auth/callback?access_token=${fakeJwt}&refresh_token=rt&expires_at=9999`;
      const res = await fetch(url);

      expect(res.ok).toBe(true);
      const html = await res.text();
      expect(html).toContain('Login successful');

      const authState = await authPromise;
      expect(authState.session.access_token).toBe(fakeJwt);
      expect(authState.session.refresh_token).toBe('rt');
      expect(authState.session.expires_at).toBe(9999);
      expect(authState.user.id).toBe('user-123');
      expect(authState.user.email).toBe('v@test.com');
      expect(authState.user.name).toBe('Volodymyr');
    });

    it('rejects when no access_token provided', async () => {
      const authPromise = startCallbackServer();

      // Attach catch handler immediately to prevent unhandled rejection
      const resultPromise = authPromise.catch((err: Error) => err);

      await new Promise((r) => setTimeout(r, 100));
      const port = getCallbackPort();

      const res = await fetch(`http://localhost:${port}/auth/callback`);
      expect(res.status).toBe(400);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Missing authentication parameters');
    });

    it('rejects when JWT decode fails', async () => {
      const authPromise = startCallbackServer();

      // Attach catch handler immediately to prevent unhandled rejection
      const resultPromise = authPromise.catch((err: Error) => err);

      await new Promise((r) => setTimeout(r, 100));
      const port = getCallbackPort();

      // JWT with only 2 parts (invalid)
      const res = await fetch(`http://localhost:${port}/auth/callback?access_token=invalid.jwt`);
      expect(res.status).toBe(500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Failed to decode access token');
    });
  });
});
