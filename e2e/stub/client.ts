// The test's side of the stub: "the browser", direct token probes, and auth.json readers.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { waitForAuthorizeUrl, type CliMachine } from '../helpers.js';
import { type StubSite } from './auth-server.js';

export interface AuthFile {
  siteFqdn: string;
  clientId: string;
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number };
}

export interface SignInRun {
  url: string;
  location: URL;
  code: number;
  output: string;
  stderr: string;
}

export const authPath = (machine: CliMachine): string => join(machine.configDir, 'auth.json');

export const readAuthFile = (machine: CliMachine): AuthFile =>
  JSON.parse(readFileSync(authPath(machine), 'utf-8')) as AuthFile;

export const fileMode = (path: string): number => statSync(path).mode & 0o777;

export const sleepUntil = (epochMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, epochMs - Date.now())));

// "The browser": authorize answers a 302 without a session; follow it to the CLI's callback.
export const browse = async (authorizeUrl: string): Promise<URL> => {
  const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
  await authorize.body?.cancel();
  expect(authorize.status, 'authorize should 302 to the callback').toBe(302);
  const location = new URL(authorize.headers.get('location') ?? 'about:blank');
  const callback = await fetch(location);
  await callback.text();
  return location;
};

// The whole `setup --no-browser` round trip; the child is killed however the test ends.
export const signInVia = async (machine: CliMachine): Promise<SignInRun> => {
  const setup = machine.startSetup();
  try {
    const url = await waitForAuthorizeUrl(setup);
    const location = await browse(url);
    const code = await setup.waitExit();
    return { url, location, code, output: setup.output(), stderr: setup.stderr() };
  } finally {
    setup.kill();
  }
};

export const sessionAt = async (site: StubSite, accessToken: string): Promise<unknown> => {
  const res = await fetch(`${site.url}/api/auth/mcp/get-session`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.json();
};

export const refreshAt = async (site: StubSite, clientId: string, refreshToken: string) => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch(`${site.url}/api/auth/mcp/token`, { method: 'POST', body });
  return { status: res.status, body: (await res.json()) as unknown };
};
