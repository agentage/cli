import { requestHeaders } from './user-agent.js';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const AUTH_TIMEOUT_MS = 15_000;

// Captured at load: plugins loaded later must not be able to swap the fetch that carries tokens.
const baseFetch = globalThis.fetch;

export type CliRequestInit = Omit<RequestInit, 'headers' | 'redirect' | 'signal'> & {
  headers?: Record<string, string>;
};

export interface CliFetchOptions {
  timeoutMs?: number;
}

// redirect: 'manual' so a bearer or form body is never replayed to a redirect target.
export const cliFetch = (
  url: string,
  init: CliRequestInit = {},
  opts: CliFetchOptions = {}
): Promise<Response> =>
  baseFetch(url, {
    ...init,
    headers: { ...init.headers, ...requestHeaders() },
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

export const isRedirect = (res: Response): boolean =>
  res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
