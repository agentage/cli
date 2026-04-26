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

const TOKENS_AND_BASE_CSS = `
  :root {
    --color-background: oklch(0.085 0.013 277);
    --color-foreground: oklch(0.97 0.003 277);
    --color-card: oklch(0.17 0.018 277);
    --color-muted-foreground: oklch(0.62 0.014 256);
    --color-primary: oklch(0.78 0.155 72);
    --color-border: oklch(0.237 0.017 277);
    --color-success: oklch(0.78 0.191 149.6);
    --color-destructive: oklch(0.7 0.208 25.6);
    --color-ring: oklch(0.78 0.155 72);
    --shadow: 0 4px 6px -1px oklch(0 0 0 / 0.4), 0 2px 4px -2px oklch(0 0 0 / 0.3);
    --radius-lg: 0.5rem;
    --radius-2xl: 1rem;
    --duration: 200ms;
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
    --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  html[data-theme='light'] {
    color-scheme: light;
    --color-background: oklch(1 0 0);
    --color-foreground: oklch(0.18 0.032 277);
    --color-card: oklch(0.98 0.003 277);
    --color-muted-foreground: oklch(0.45 0.012 256);
    --color-primary: oklch(0.7 0.155 72);
    --color-border: oklch(0.91 0.005 277);
    --shadow: 0 4px 6px -1px oklch(0 0 0 / 0.08), 0 2px 4px -2px oklch(0 0 0 / 0.06);
  }
  @media (prefers-color-scheme: light) {
    html:not([data-theme='dark']) {
      color-scheme: light;
      --color-background: oklch(1 0 0);
      --color-foreground: oklch(0.18 0.032 277);
      --color-card: oklch(0.98 0.003 277);
      --color-muted-foreground: oklch(0.45 0.012 256);
      --color-primary: oklch(0.7 0.155 72);
      --color-border: oklch(0.91 0.005 277);
      --shadow: 0 4px 6px -1px oklch(0 0 0 / 0.08), 0 2px 4px -2px oklch(0 0 0 / 0.06);
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { color-scheme: dark; }
  html, body {
    background: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    width: 100%;
    max-width: 24rem;
    padding: 2rem;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow);
    text-align: center;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.05rem;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    margin-bottom: 1rem;
    color: var(--color-foreground);
  }
  .wordmark svg.heart {
    width: 1.125rem;
    height: 1.125rem;
    color: var(--color-primary);
    fill: currentColor;
    display: inline-block;
  }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border: 0;
  }
  .status {
    font-size: 1rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .status-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    display: inline-block;
  }
  .status-success { color: var(--color-success); }
  .status-error { color: var(--color-destructive); }
  .message {
    color: var(--color-muted-foreground);
    font-size: 0.875rem;
    line-height: 1.5;
    margin-bottom: 0.5rem;
  }
  .button-stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-lg);
    font-size: 0.9375rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid transparent;
    text-decoration: none;
    transition: background-color var(--duration) var(--ease);
  }
  .btn:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }
  .btn:active { transform: scale(0.98); }
  .btn-primary {
    background: oklch(1 0 0);
    color: oklch(0.18 0.032 277);
  }
  .btn-primary:hover { background: oklch(0.94 0 0); }
  @media (prefers-reduced-motion: reduce) {
    .btn, .btn:active { transition: none; transform: none; }
  }
`;

const HEART_SVG =
  `<svg class="heart" viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M12 21s-7-4.5-9.5-9C1 9 2 5 6 4c2.5-.5 4.5 1 6 3 1.5-2 3.5-3.5 6-3 4 1 5 5 3.5 8-2.5 4.5-9.5 9-9.5 9z"/>` +
  `</svg>`;

const wordmarkHtml =
  `<h1 class="wordmark">` +
  `<span>Agent</span>${HEART_SVG}<span class="sr-only">love</span><span>Age</span>` +
  `</h1>`;

const themeBootScript = `(function(){try{var s=localStorage.getItem('agentage_theme');if(s==='light'||s==='dark'){document.documentElement.setAttribute('data-theme',s);}}catch(e){}})();`;

const checkIconSvg = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const xIconSvg = `<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildPage = (opts: {
  title: string;
  message: string;
  status: PageStatus;
  dashboardUrl?: string;
}): string => {
  const isSuccess = opts.status === 'success';
  const icon = isSuccess ? checkIconSvg : xIconSvg;
  const tone = isSuccess ? 'success' : 'error';
  const dashboardButton = opts.dashboardUrl
    ? `<div class="button-stack"><a href="${escapeHtml(opts.dashboardUrl)}" class="btn btn-primary">Open Dashboard</a></div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)} — Agentage</title>
  <style>${TOKENS_AND_BASE_CSS}</style>
  <script>${themeBootScript}</script>
</head>
<body>
  <main class="card" role="main">
    ${wordmarkHtml}
    <p class="status status-${tone}" role="status" aria-live="polite">${icon}<span>${escapeHtml(opts.title)}</span></p>
    <p class="message">${escapeHtml(opts.message)}</p>
    ${dashboardButton}
  </main>
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
