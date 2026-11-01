/**
 * The account side of the loopback site, as a test reads and changes it: what the CLI sent to
 * /v1/profile and /v1/machines, the profile the account holds, and the account misbehaving.
 */
import {
  type StubMachine,
  type StubProfile,
  type StubRequest,
  type StubSite,
} from '../stub/auth-server.js';
import { storeProfile } from '../stub/profile.js';

type Doc = Record<string, unknown>;

export interface Site {
  // What the CLI sent to the account routes starting with `path`, oldest first.
  requests: (path?: string) => StubRequest[];
  // The profile the account holds ({ version, profile, lock, npmMajor, etag }), or null.
  profile: () => StubProfile | null;
  // Stores a profile document as another machine's push would, and returns its new etag.
  store: (doc: Doc) => string;
  // Each next push first meets another machine's push adding these extensions (package names).
  conflict: (...pushes: Record<string, string>[]) => void;
  // From now on the route answers 503, never answers ('hang'), or is not there ('missing': 404).
  fail: (route: 'profile' | 'machines', how?: '503' | 'hang' | 'missing') => void;
  machines: () => StubMachine[];
}

const adding =
  (extensions: Record<string, string>) =>
  (doc: Doc): Doc => ({ ...doc, extensions: { ...(doc['extensions'] as Doc), ...extensions } });

export const siteOf = ({ state }: StubSite): Site => ({
  requests: (path = '/v1/') => state.requests.filter((r) => r.path.startsWith(path)),
  profile: () => state.account.profile,
  store: (doc) => storeProfile(state.account, { version: 1, profile: doc }).etag,
  conflict: (...pushes) => void state.account.conflicts.push(...pushes.map(adding)),
  fail: (route, how = '503') => void (state.account.modes[route] = how),
  machines: () => [...state.account.machines.values()],
});
