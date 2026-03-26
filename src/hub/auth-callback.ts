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

type PageStatus = 'success' | 'error';

const buildPage = (opts: {
  title: string;
  message: string;
  status: PageStatus;
  dashboardUrl?: string;
}): string => {
  const isSuccess = opts.status === 'success';
  const color = isSuccess ? '#22c55e' : '#ef4444';
  const icon = isSuccess
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  const dashboardButton = opts.dashboardUrl
    ? `<a href="${opts.dashboardUrl}" style="display:inline-block;margin-top:24px;padding:10px 32px;background:#f5a623;color:#0a0a0f;font-weight:600;font-size:14px;border-radius:9999px;text-decoration:none;transition:background 0.2s" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f5a623'">Open Dashboard</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title} — Agentage</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: #1a1a24;
      border: 1px solid #2a2a34;
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5), 0 2px 4px -2px rgba(0,0,0,0.3);
    }
    .logo { color: #f5a623; font-size: 20px; font-weight: 700; margin-bottom: 24px; }
    .icon { display: flex; justify-content: center; margin-bottom: 16px; }
    h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: ${color}; }
    p { color: #6b7280; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Agentage</div>
    <div class="icon">${icon}</div>
    <h2>${opts.title}</h2>
    <p>${opts.message}</p>
    ${dashboardButton}
  </div>
</body>
</html>`;
};

export const startCallbackServer = (hubUrl?: string): Promise<AuthState> =>
  new Promise((resolve, reject) => {
    const app = express();
    const dashboardUrl = hubUrl ? `${hubUrl}/dashboard` : undefined;

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
              buildPage({
                title: 'Login successful!',
                message: 'You can close this window and return to the terminal.',
                status: 'success',
                dashboardUrl,
              })
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
            const errorHtml = buildPage({
              title: 'Login failed',
              message: 'Failed to decode access token.',
              status: 'error',
            });
            res.status(500).send(errorHtml);
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
        const missingHtml = buildPage({
          title: 'Login failed',
          message: 'Missing authentication parameters.',
          status: 'error',
        });
        res.status(400).send(missingHtml);
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
