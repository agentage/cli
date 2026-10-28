// The one page the CLI ever serves: the sign-in result, on the design-system dark tokens.
const LOGO =
  'M143.8 33.7a13.2 13.2 0 00-23.6 0l-92.4 184.8a13.2 13.2 0 0015.4 18.6l66-18.9a13.2 13.2 0 ' +
  '009.5-12.7v-60.3a13.2 13.2 0 1126.4 0v60.3a13.2 13.2 0 009.6 12.7l66 18.9a13.2 13.2 0 ' +
  '0015.4-18.6l-92.3-184.8z';

const STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
html{color-scheme:dark}
body{background:oklch(0.085 0.013 277);color:oklch(0.97 0.003 277);
font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
-webkit-font-smoothing:antialiased;min-height:100vh;display:grid;place-items:center;padding:24px}
.card{background:oklch(0.17 0.018 277);border:1px solid oklch(0.237 0.017 277);border-radius:.75rem;
padding:40px 32px;width:100%;max-width:400px;text-align:center;
box-shadow:0 10px 15px -3px oklch(0 0 0/.1),0 4px 6px -4px oklch(0 0 0/.1)}
.brand{display:inline-flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:600;font-size:1rem}
.brand svg{width:28px;height:28px}
.icon{width:48px;height:48px;border-radius:9999px;margin:0 auto 20px;display:grid;place-items:center}
.ok .icon{background:oklch(0.723 0.191 149.6/.15);color:oklch(0.723 0.191 149.6)}
.err .icon{background:oklch(0.628 0.208 25.6/.15);color:oklch(0.628 0.208 25.6)}
h1{font-size:1.25rem;font-weight:600;letter-spacing:-.02em;margin-bottom:8px}
p{color:oklch(0.59 0.014 256);font-size:.875rem;line-height:1.5}
.hint{margin-top:24px;font-size:.75rem;color:oklch(0.59 0.014 256)}
`;

const ICON = {
  ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  err: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// The error text comes from the authorization server's redirect: never trust it as markup.
export const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

export const callbackPage = (ok: boolean, detail: string): string => {
  const kind = ok ? 'ok' : 'err';
  const title = ok ? 'Signed in' : 'Sign-in failed';
  const hint = ok ? 'You can close this tab.' : 'Run agentage setup again to retry.';
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title} - agentage</title><style>${STYLE}</style></head><body><main class="card ${kind}">` +
    `<div class="brand"><svg viewBox="0 0 416 416" aria-hidden="true"><rect width="416" height="416" rx="83" fill="#f3a52b"/>` +
    `<g transform="translate(25.7 25.7) scale(1.3812)"><path d="${LOGO}" fill="#000"/></g></svg>agentage</div>` +
    `<div class="icon">${ICON[kind]}</div><h1>${title}</h1><p>${escapeHtml(detail)}</p>` +
    `<p class="hint">${hint}</p></main></body></html>`
  );
};
