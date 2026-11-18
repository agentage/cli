import { cliFetch } from '../net/fetch.js';

export interface AccountUser {
  id: string;
  email: string;
}

const TIMEOUT_MS = 5_000;

const userOf = (body: unknown): AccountUser | undefined => {
  const user = (body as { data?: { user?: Record<string, unknown> } } | null)?.data?.user;
  const { id, email } = user ?? {};
  return typeof id === 'string' && typeof email === 'string' ? { id, email } : undefined;
};

// The user a cloud app host's shell shows: auth answers its exchange with { id, email }, so the
// local shell reads the same fields. The short token in the answer is dropped, never stored.
export const fetchAccountUser = async (
  issuer: string,
  accessToken: string
): Promise<AccountUser | undefined> => {
  try {
    const res = await cliFetch(
      `${issuer}/account/extension-token`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ extension: 'platform', access: 'read' }),
      },
      { timeoutMs: TIMEOUT_MS }
    );
    return res.status === 201 ? userOf(await res.json()) : void (await res.body?.cancel());
  } catch {
    return undefined;
  }
};
