/**
 * The hermetic stand-in for the live stack: one plain-http loopback origin
 * (AGENTAGE_SITE_FQDN=127.0.0.1:<port>, so site, api and auth share it) serving
 * exactly what the CLI calls - health, DCR, authorize, token, get-session, revoke.
 * No cookies, no HTML: the test plays "the browser" with a manual-redirect fetch.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  closeServer,
  json,
  listenLoopback,
  parseJson,
  readBody,
  send,
  type Reply,
} from './http.js';
import { authorize, getSession, register, revoke, token } from './oauth.js';
import { createState, type StubOptions, type StubRequest, type StubState } from './state.js';

export { type StubOptions, type StubState, type StubToken } from './state.js';

export interface StubSite {
  fqdn: string;
  url: string;
  close: () => Promise<void>;
  state: StubState;
}

interface RouteContext {
  state: StubState;
  req: IncomingMessage;
  url: URL;
  entry: StubRequest;
}

type Route = (ctx: RouteContext) => Reply | Promise<Reply>;

const readForm = async (req: IncomingMessage): Promise<URLSearchParams> =>
  new URLSearchParams(await readBody(req));

const tokenRoute: Route = async ({ state, req, entry }) => {
  const form = await readForm(req);
  entry.grantType = form.get('grant_type') ?? undefined;
  return token(state, form);
};

const ROUTES: Record<string, Route> = {
  'GET /api/health': () => json(200, { status: 'ok' }),
  'POST /api/auth/mcp/register': async ({ state, req }) =>
    register(state, parseJson(await readBody(req))),
  'GET /api/auth/mcp/authorize': ({ state, url }) => authorize(state, url.searchParams),
  'POST /api/auth/mcp/token': tokenRoute,
  'GET /api/auth/mcp/get-session': ({ state, req }) => getSession(state, req.headers.authorization),
  'POST /api/auth/mcp/revoke': async ({ state, req }) => revoke(state, await readForm(req)),
};

const dispatch = async (state: StubState, req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const entry: StubRequest = { method: req.method ?? 'GET', path: url.pathname, status: 0 };
  const route = ROUTES[`${entry.method} ${entry.path}`];
  const reply = route ? await route({ state, req, url, entry }) : json(404, { error: 'not_found' });
  entry.status = reply.status;
  state.requests.push(entry);
  send(res, reply);
};

export const startStubSite = async (opts: StubOptions = {}): Promise<StubSite> => {
  const state = createState(opts);
  const { server, port } = await listenLoopback();
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    dispatch(state, req, res).catch(() => send(res, json(500, { error: 'server_error' })));
  });
  const fqdn = `127.0.0.1:${port}`;
  return { fqdn, url: `http://${fqdn}`, state, close: () => closeServer(server) };
};

// Unroutable proxies keep the CLI's other https lookups (the npm update check) off the network
// where Node honours env proxies; loopback stays direct.
const BLACKHOLE = 'http://127.0.0.1:1';
const LOOPBACK = '127.0.0.1,localhost';

export const stubEnv = (site: StubSite): NodeJS.ProcessEnv => ({
  AGENTAGE_SITE_FQDN: site.fqdn,
  NODE_USE_ENV_PROXY: '1',
  HTTP_PROXY: BLACKHOLE,
  HTTPS_PROXY: BLACKHOLE,
  http_proxy: BLACKHOLE,
  https_proxy: BLACKHOLE,
  NO_PROXY: LOOPBACK,
  no_proxy: LOOPBACK,
});
