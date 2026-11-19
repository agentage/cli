import { type Platform } from '../net/discovery.js';

type Call = (url: string) => Promise<Response>;

// The machines routes of the platform: one base, no v13 route (J.4.3).
export const machinesCall = (platform: Platform, path: string, call: Call) =>
  call(`${platform.machines}${path}`);
