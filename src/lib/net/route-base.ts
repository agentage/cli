import { isRecord } from '../fs/json-file.js';

type Call = (url: string) => Promise<Response>;

// A route family at `primary`, or at the v13 `fallback` on a host without it (until the P.7 swap).
export interface Bases {
  primary: string;
  fallback?: string;
}

// Whether a response means the host has no such route (not the route's own refusal).
export type Missing = (res: Response) => Promise<boolean>;

// The base that answered, per primary base: a v13 row costs one 404 per run, not one per call.
const chosen = new Map<string, string>();

export const forgetRouteBases = (): void => chosen.clear();

// 4xx codes a route itself answers; 401, 403, 429 or an unknown body may be the edge's, not the route's.
const OWNED = new Set(['VALIDATION_ERROR', 'CONFLICT', 'PRECONDITION_FAILED', 'MACHINE_NOT_FOUND']);

const codeOf = async (res: Response): Promise<unknown> => {
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  return error['code'];
};

// Only a 2xx or the route's own refusal pins a base.
const pins = async (res: Response): Promise<boolean> =>
  res.ok || (res.status >= 400 && res.status < 500 && OWNED.has(String(await codeOf(res))));

// `primary` first, then `fallback` on a missing route; a 5xx, 401, 403 or 429 decides nothing.
export const routeCall = async (
  { primary, fallback }: Bases,
  path: string,
  call: Call,
  missing: Missing
) => {
  const known = chosen.get(primary);
  if (known !== undefined || fallback === undefined) return call(`${known ?? primary}${path}`);
  const res = await call(`${primary}${path}`);
  if (!(await missing(res))) {
    if (await pins(res)) chosen.set(primary, primary);
    return res;
  }
  // Unawaited: a tee'd body (a clone) cancels only once its sibling does.
  void res.body?.cancel().catch(() => undefined);
  const old = await call(`${fallback}${path}`);
  if (!(await missing(old)) && (await pins(old))) chosen.set(primary, fallback);
  return old;
};
