import { authedPost } from './api.js';
import { readAuth, type AuthState } from '../fs/config.js';
import { links as buildLinks, siteFqdn, type Links } from '../net/origins.js';

// Create the account-side memory for an account vault. Offline-first: this is NEVER fatal to the
// local registration - the caller keeps the local entry whatever happens here, and the discover
// watcher re-provisions idempotently later. It creates the memory in the account only: nothing
// syncs it to this machine.

export type ProvisionStatus = 'provisioned' | 'exists' | 'unauthenticated' | 'offline';

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
      message: registeredLocally(name, ' - run `agentage setup` to create it in your account.'),
    };
  }
  // A PAT is an MCP-surface credential; the backend REST provisioning endpoint rejects plain
  // bearers (only session cookies), so it cannot create the account memory. Fail clearly.
  if (auth.kind === 'pat') {
    return {
      status: 'unauthenticated',
      message: registeredLocally(
        name,
        ' - account provisioning needs an interactive session (run `agentage setup`); ' +
          'a personal access token only authorizes memory (MCP) calls.'
      ),
    };
  }

  const links = deps.links();
  let res: Response;
  try {
    res = await deps.post(auth, links, `${links.api}/memories`, { name });
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
      message: registeredLocally(name, ' - run `agentage setup` to create it in your account.'),
    };

  // Any other status stays non-fatal: keep the local entry, let the daemon retry later.
  return { status: 'offline', message: registeredLocally(name, ' - will provision when online.') };
};
