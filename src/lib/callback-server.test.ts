import { describe, expect, it } from 'vitest';
import { startCallbackServer, type CallbackServer } from './callback-server.js';

const get = async (server: CallbackServer, query: string, path = '/callback') => {
  const base = server.redirectUri.replace('/callback', '');
  return fetch(`${base}${path}${query}`);
};

describe('startCallbackServer', () => {
  it('resolves the code on a valid callback and renders a success page', async () => {
    const server = await startCallbackServer('state-1');
    try {
      const res = await get(server, '?code=code-1&state=state-1');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Signed in');
      await expect(server.waitForCode(1000)).resolves.toBe('code-1');
    } finally {
      server.close();
    }
  });

  it('resolves when waitForCode is awaited before the callback arrives', async () => {
    const server = await startCallbackServer('state-1');
    try {
      const pending = server.waitForCode(2000);
      await get(server, '?code=code-2&state=state-1');
      await expect(pending).resolves.toBe('code-2');
    } finally {
      server.close();
    }
  });

  it('ignores unrelated paths like favicon requests', async () => {
    const server = await startCallbackServer('state-1');
    try {
      const res = await get(server, '', '/favicon.ico');
      expect(res.status).toBe(404);
      await get(server, '?code=code-3&state=state-1');
      await expect(server.waitForCode(1000)).resolves.toBe('code-3');
    } finally {
      server.close();
    }
  });

  it('rejects on state mismatch with a 400', async () => {
    const server = await startCallbackServer('expected');
    try {
      const res = await get(server, '?code=x&state=wrong');
      expect(res.status).toBe(400);
      await expect(server.waitForCode(1000)).rejects.toThrow('state mismatch');
    } finally {
      server.close();
    }
  });

  it('rejects when the provider returns an error', async () => {
    const server = await startCallbackServer('s');
    try {
      await get(server, '?error=access_denied&state=s');
      await expect(server.waitForCode(1000)).rejects.toThrow('access_denied');
    } finally {
      server.close();
    }
  });

  it('times out when no callback arrives', async () => {
    const server = await startCallbackServer('s');
    try {
      await expect(server.waitForCode(20)).rejects.toThrow('timed out');
    } finally {
      server.close();
    }
  });
});
