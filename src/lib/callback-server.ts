import { createServer } from 'node:http';

export interface CallbackServer {
  redirectUri: string;
  waitForCode: (timeoutMs?: number) => Promise<string>;
  close: () => void;
}

const page = (ok: boolean, detail: string): string =>
  '<!doctype html><html><head><meta charset="utf-8"><title>agentage</title></head>' +
  '<body style="font-family:system-ui;display:grid;place-items:center;min-height:80vh">' +
  `<div style="text-align:center"><h1>${ok ? 'Signed in' : 'Sign-in failed'}</h1>` +
  `<p>${detail}</p></div></body></html>`;

interface Settle {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

export const startCallbackServer = (expectedState: string): Promise<CallbackServer> =>
  new Promise((resolveServer) => {
    let settle: Settle | null = null;
    let result: { code?: string; error?: Error } | null = null;

    const finish = (code?: string, error?: Error): void => {
      if (result) return;
      result = { code, error };
      if (settle && code) settle.resolve(code);
      else if (settle && error) settle.reject(error);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(page(false, error));
        finish(undefined, new Error(`authorization failed: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page(false, 'Invalid callback.'));
        finish(undefined, new Error('invalid callback (state mismatch)'));
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(page(true, 'You can return to the terminal.'));
      finish(code);
    });

    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveServer({
        redirectUri: `http://localhost:${port}/callback`,
        waitForCode: (timeoutMs = 300_000) =>
          new Promise<string>((resolve, reject) => {
            if (result) {
              if (result.code) resolve(result.code);
              else reject(result.error ?? new Error('sign-in failed'));
              return;
            }
            const timer = setTimeout(
              () => reject(new Error('timed out waiting for sign-in')),
              timeoutMs
            );
            timer.unref();
            settle = {
              resolve: (code) => {
                clearTimeout(timer);
                resolve(code);
              },
              reject: (err) => {
                clearTimeout(timer);
                reject(err);
              },
            };
          }),
        close: () => server.close(),
      });
    });
  });
