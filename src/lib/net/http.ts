import { get } from 'node:https';

export interface UnrefResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

// node:https instead of global fetch: undici keeps a ref'd ~10s connect timer alive even after
// its AbortSignal fires, stalling process exit on an unreachable network. req.destroy() from an
// unref'd timer caps the whole attempt and frees the event loop the moment it settles. Never
// throws: an unreachable host or malformed body resolves null (unreachable) or json:null.
export const fetchJsonUnref = (url: string, timeoutMs: number): Promise<UnrefResponse | null> =>
  new Promise((resolve) => {
    const req = get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        let json: unknown = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = null;
        }
        resolve({ ok: status >= 200 && status < 300, status, json });
      });
    });
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    timer.unref();
    req.once('error', () => resolve(null));
    req.once('close', () => {
      clearTimeout(timer);
      resolve(null); // no-op when already resolved
    });
  });
