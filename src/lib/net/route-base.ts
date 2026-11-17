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

// `primary` first, then `fallback` on a missing route; a 5xx decides nothing.
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
    if (res.status < 500) chosen.set(primary, primary);
    return res;
  }
  // Unawaited: a tee'd body (a clone) cancels only once its sibling does.
  void res.body?.cancel().catch(() => undefined);
  const old = await call(`${fallback}${path}`);
  if (old.status < 500 && !(await missing(old))) chosen.set(primary, fallback);
  return old;
};
