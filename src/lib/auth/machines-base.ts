import { isRecord } from '../fs/json-file.js';
import { type Platform } from '../net/discovery.js';
import { forgetRouteBases, routeCall } from '../net/route-base.js';

type Call = (url: string) => Promise<Response>;

export const forgetMachinesBases = forgetRouteBases;

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
export const machinesCall = (platform: Platform, path: string, call: Call) =>
  routeCall({ primary: platform.machines, fallback: platform.fallback }, path, call, missingRoute);
