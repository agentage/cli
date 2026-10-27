import { get as httpGet, type ClientRequest, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';

export interface UnrefResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

type Getter = (
  url: string,
  options: { headers: Record<string, string> },
  callback: (res: IncomingMessage) => void
) => ClientRequest;

// Loopback stubs (AGENTAGE_SITE_FQDN=127.0.0.1:<port>) are plain http; every real target is https.
const getterFor = (url: string): Getter | null => {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:') return httpsGet;
    if (protocol === 'http:') return httpGet;
  } catch {
    // not a URL
  }
  return null;
};

const parseJson = (body: string): unknown => {
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
};

const collect = (res: IncomingMessage, resolve: (r: UnrefResponse) => void): void => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    body += chunk;
  });
  res.on('end', () => {
    const status = res.statusCode ?? 0;
    resolve({ ok: status >= 200 && status < 300, status, json: parseJson(body) });
  });
};

// A synchronous throw (e.g. an invalid header value) is a failed request, not a crash.
const start = (
  url: string,
  headers: Record<string, string>,
  resolve: (r: UnrefResponse | null) => void
): ClientRequest | null => {
  const get = getterFor(url);
  if (!get) return null;
  try {
    return get(url, { headers: { Accept: 'application/json', ...headers } }, (res) =>
      collect(res, resolve)
    );
  } catch {
    return null;
  }
};

// node:http(s), not fetch: undici's ref'd connect timer outlives an abort and stalls process exit.
export const fetchJsonUnref = (
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<UnrefResponse | null> =>
  new Promise((resolve) => {
    const req = start(url, headers, resolve);
    if (!req) return resolve(null);
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    timer.unref();
    req.once('error', () => resolve(null));
    req.once('close', () => {
      clearTimeout(timer);
      resolve(null); // no-op when already resolved
    });
  });
