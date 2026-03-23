import express from 'express';
import { type AuthState } from './auth.js';

interface JwtPayload {
  sub?: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
  };
}

const decodeJwtPayload = (token: string): JwtPayload => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1];
  const json = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(json) as JwtPayload;
};

export const startCallbackServer = (): Promise<AuthState> =>
  new Promise((resolve, reject) => {
    const app = express();

    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // Timeout after 120 seconds
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Login timed out — no callback received within 120 seconds'));
      }, 120_000);

      app.get('/auth/callback', (req, res) => {
        clearTimeout(timeout);

        const accessToken = req.query.access_token as string | undefined;
        const refreshToken = req.query.refresh_token as string | undefined;
        const expiresAt = req.query.expires_at as string | undefined;

        if (accessToken) {
          // Primary flow — tokens provided directly by the hub login page
          try {
            const payload = decodeJwtPayload(accessToken);

            res.send(
              '<html><body><h2>Login successful!</h2><p>You can close this window.</p></body></html>'
            );
            server.close();

            resolve({
              session: {
                access_token: accessToken,
                refresh_token: refreshToken ?? '',
                expires_at: expiresAt ? Number(expiresAt) : 0,
              },
              user: {
                id: payload.sub ?? '',
                email: payload.email ?? '',
                name: payload.user_metadata?.full_name ?? payload.user_metadata?.name ?? '',
                avatar: payload.user_metadata?.avatar_url ?? '',
              },
              hub: {
                url: '',
                machineId: '',
              },
            });
          } catch (err) {
            res.status(500).send('Failed to decode access token');
            server.close();
            reject(
              new Error(
                `Failed to decode access token: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          }
          return;
        }

        // No recognized params
        res.status(400).send('Missing authentication parameters');
        server.close();
        reject(new Error('Missing authentication parameters in callback'));
      });

      // Export port for the caller to build the OAuth URL
      (server as { callbackPort?: number }).callbackPort = port;
    });

    // Expose the server for the caller to read the port
    (startCallbackServer as { _server?: typeof server })._server = server;
  });

export const getCallbackPort = (): number => {
  const server = (startCallbackServer as { _server?: { address: () => unknown } })._server;
  if (!server) return 0;
  const addr = server.address();
  return typeof addr === 'object' && addr ? (addr as { port: number }).port : 0;
};
