import { type IncomingMessage, type RequestListener } from 'node:http';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

// Why a request does not come from this machine's own pages, or null when it does.
export const refusedBy = (req: IncomingMessage, port: number): string | null => {
  const hosts = LOOPBACK.map((name) => `${name}:${port}`);
  // A Host other than the loopback one is DNS rebinding: a page of another site on our port.
  if (!hosts.includes(req.headers.host ?? '')) return 'host';
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return 'sec-fetch-site';
  const origin = req.headers.origin;
  if (origin && !hosts.some((host) => origin === `http://${host}`)) return 'origin';
  return null;
};

// The cli's minimum in front of the kit app, until the kit's own guard is mounted.
export const loopbackOnly =
  (next: RequestListener, port: () => number): RequestListener =>
  (req, res) => {
    const why = refusedBy(req, port());
    if (!why) return next(req, res);
    res.writeHead(403, { 'content-type': 'application/json' });
    const message = `refused: ${why} is not this machine's`;
    res.end(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message } }));
  };
