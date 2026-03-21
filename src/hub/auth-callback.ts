import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { type AuthState } from './auth.js';

export const startCallbackServer = (
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<AuthState> =>
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

      app.get('/auth/callback', async (req, res) => {
        clearTimeout(timeout);

        const code = req.query.code as string | undefined;

        if (!code) {
          res.status(400).send('Missing authorization code');
          server.close();
          reject(new Error('Missing authorization code in callback'));
          return;
        }

        try {
          const supabase = createClient(supabaseUrl, supabaseAnonKey);
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);

          if (error || !data.session) {
            res.status(500).send('Failed to exchange code for session');
            server.close();
            reject(new Error(`Auth exchange failed: ${error?.message ?? 'no session'}`));
            return;
          }

          res.send(
            '<html><body><h2>Login successful!</h2><p>You can close this window.</p></body></html>'
          );
          server.close();

          resolve({
            session: {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_at: data.session.expires_at ?? 0,
            },
            user: {
              id: data.user.id,
              email: data.user.email ?? '',
              name:
                (data.user.user_metadata?.full_name as string) ??
                (data.user.user_metadata?.name as string) ??
                '',
              avatar: (data.user.user_metadata?.avatar_url as string) ?? '',
            },
            hub: {
              url: '',
              machineId: '',
            },
          });
        } catch (err) {
          res.status(500).send('Auth error');
          server.close();
          reject(err);
        }
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
