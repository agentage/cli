import { isRecord } from '../fs/json-file.js';
import { type Platform } from '../net/discovery.js';

type Call = (url: string) => Promise<Response>;

// The base that answered, per platform: a v13 row costs one 404 per run, not one per call.
const chosen = new Map<string, string>();

export const forgetMachinesBases = (): void => chosen.clear();

// The machines route's own 404 is MACHINE_NOT_FOUND; any other 404 is a host without the route.
const missingRoute = async (res: Response): Promise<boolean> => {
  if (res.status !== 404) return false;
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  return error['code'] !== 'MACHINE_NOT_FOUND';
};

// `machines` first, then the v13 `fallback` on a missing route; a 5xx decides nothing.
export const machinesCall = async (platform: Platform, path: string, call: Call) => {
  const { machines, fallback } = platform;
  const known = chosen.get(machines);
  if (known !== undefined || fallback === undefined) return call(`${known ?? machines}${path}`);
  const res = await call(`${machines}${path}`);
  if (!(await missingRoute(res))) {
    if (res.status < 500) chosen.set(machines, machines);
    return res;
  }
  await res.body?.cancel();
  const old = await call(`${fallback}${path}`);
  if (old.status < 500 && !(await missingRoute(old))) chosen.set(machines, fallback);
  return old;
};
