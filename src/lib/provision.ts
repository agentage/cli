import { authedPost } from './api.js';
import { readAuth, type AuthState } from './config.js';
import { links as buildLinks, siteFqdn, type Links } from './origins.js';

// Provision an account vault's cloud channel. Offline-first: this is NEVER fatal to the local
// registration - the caller keeps the local entry whatever happens here, and the daemon sync
// loop re-provisions idempotently later.

export type ProvisionStatus =
  'provisioned' | 'exists' | 'disabled' | 'conflict' | 'unauthenticated' | 'offline';

export interface ProvisionResult {
  status: ProvisionStatus;
  message: string;
}

export interface ProvisionDeps {
  readAuth: () => AuthState | null;
  links: () => Links;
  post: (auth: AuthState, links: Links, url: string, body: unknown) => Promise<Response>;
}

export const defaultProvisionDeps = (): ProvisionDeps => ({
  readAuth,
  links: () => buildLinks(siteFqdn()),
  post: authedPost,
});

// The API error envelope carries the code as `error.code` (or a top-level `code`); read it best
// effort - a non-JSON body just yields undefined and the caller falls back to non-fatal.
const errorCode = async (res: Response): Promise<string | undefined> => {
  try {
    const body = (await res.json()) as { error?: { code?: string }; code?: string };
    return body.error?.code ?? body.code;
  } catch {
    return undefined;
  }
};

const registeredLocally = (name: string, tail: string): string =>
  `Vault '${name}' registered locally${tail}`;

export const provisionAccountVault = async (
  name: string,
  deps: ProvisionDeps = defaultProvisionDeps()
): Promise<ProvisionResult> => {
  const auth = deps.readAuth();
  if (!auth) {
    return {
      status: 'unauthenticated',
      message: registeredLocally(name, ' - run `agentage setup` to sync.'),
    };
  }

  const links = deps.links();
  let res: Response;
  try {
    res = await deps.post(auth, links, `${links.api}/memories`, { name, channel: 'couch' });
  } catch {
    return {
      status: 'offline',
      message: registeredLocally(name, ' - will provision when online.'),
    };
  }

  if (res.status === 201)
    return { status: 'provisioned', message: `Provisioned account vault '${name}'.` };
  if (res.status === 200)
    return { status: 'exists', message: `Account vault '${name}' already provisioned.` };
  if (res.status === 401)
    return {
      status: 'unauthenticated',
      message: registeredLocally(name, ' - run `agentage setup` to sync.'),
    };

  const code = await errorCode(res);
  if (res.status === 403 && code === 'CHANNEL_DISABLED')
    return {
      status: 'disabled',
      message: registeredLocally(name, '. Account sync is not enabled on this server.'),
    };
  if (res.status === 409 && code === 'CHANNEL_CONFLICT')
    return {
      status: 'conflict',
      message: registeredLocally(
        name,
        `. A memory named '${name}' already exists on another channel - not syncing.`
      ),
    };

  // Any other status stays non-fatal: keep the local entry, let the daemon retry later.
  return { status: 'offline', message: registeredLocally(name, ' - will provision when online.') };
};
