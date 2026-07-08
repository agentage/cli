import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  DEFAULT_SCOPE,
  exchangeCode,
  pkcePair,
  randomState,
  refreshTokens,
  registerClient,
  revokeToken,
} from './oauth.js';

interface Captured {
  url: string;
  contentType: string;
  body: string;
}

let server: Server;
let baseUrl: string;
let captured: Captured[];
let nextResponse: { status: number; body: string };

beforeAll(async () => {
  captured = [];
  nextResponse = { status: 200, body: '{}' };
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      captured.push({
        url: req.url ?? '',
        contentType: req.headers['content-type'] ?? '',
        body,
      });
      res.writeHead(nextResponse.status, { 'content-type': 'application/json' });
      res.end(nextResponse.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

describe('pkcePair', () => {
  it('produces an S256 challenge of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('randomState', () => {
  it('is unique and url-safe', () => {
    expect(randomState()).not.toBe(randomState());
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('sets every OAuth 2.1 parameter', () => {
    const url = new URL(
      buildAuthorizeUrl('https://auth.example', {
        clientId: 'c1',
        redirectUri: 'http://localhost:1234/callback',
        challenge: 'ch',
        state: 'st',
      })
    );
    expect(url.pathname).toBe('/api/auth/mcp/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('c1');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1234/callback');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('scope')).toBe(DEFAULT_SCOPE);
  });
});

describe('registerClient', () => {
  it('posts a public-client DCR registration and returns client_id', async () => {
    nextResponse = { status: 201, body: JSON.stringify({ client_id: 'client-9' }) };
    const id = await registerClient(baseUrl, 'http://localhost:1/callback');
    expect(id).toBe('client-9');
    const last = captured.at(-1);
    expect(last?.url).toBe('/api/auth/mcp/register');
    expect(last?.contentType).toContain('application/json');
    const body = JSON.parse(last?.body ?? '{}') as Record<string, unknown>;
    expect(body['redirect_uris']).toEqual(['http://localhost:1/callback']);
    expect(body['token_endpoint_auth_method']).toBe('none');
    expect(body['grant_types']).toEqual(['authorization_code', 'refresh_token']);
  });

  it('throws on non-2xx and on missing client_id', async () => {
    nextResponse = { status: 403, body: '{}' };
    await expect(registerClient(baseUrl, 'http://localhost:1/callback')).rejects.toThrow('403');
    nextResponse = { status: 200, body: '{}' };
    await expect(registerClient(baseUrl, 'http://localhost:1/callback')).rejects.toThrow(
      'no client_id'
    );
  });
});

describe('exchangeCode / refreshTokens', () => {
  it('sends the authorization_code grant as a form', async () => {
    nextResponse = { status: 200, body: JSON.stringify({ access_token: 'at' }) };
    const tokens = await exchangeCode(baseUrl, {
      clientId: 'c1',
      code: 'code-1',
      redirectUri: 'http://localhost:1/callback',
      verifier: 'v1',
    });
    expect(tokens.access_token).toBe('at');
    const last = captured.at(-1);
    expect(last?.url).toBe('/api/auth/mcp/token');
    expect(last?.contentType).toContain('application/x-www-form-urlencoded');
    const form = new URLSearchParams(last?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('code_verifier')).toBe('v1');
    expect(form.get('client_id')).toBe('c1');
  });

  it('sends the refresh_token grant and surfaces failures', async () => {
    nextResponse = { status: 200, body: JSON.stringify({ access_token: 'at2' }) };
    await refreshTokens(baseUrl, 'c1', 'rt');
    const form = new URLSearchParams(captured.at(-1)?.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt');
    nextResponse = { status: 400, body: '{}' };
    await expect(refreshTokens(baseUrl, 'c1', 'rt')).rejects.toThrow('400');
  });
});

describe('revokeToken', () => {
  it('is best-effort: never throws', async () => {
    nextResponse = { status: 500, body: '{}' };
    await expect(revokeToken(baseUrl, 'at')).resolves.toBeUndefined();
    await expect(revokeToken('http://127.0.0.1:1', 'at')).resolves.toBeUndefined();
  });

  it('aborts a stalled revoke within the timeout instead of hanging', async () => {
    const hang = createServer(() => {
      // never responds: the AbortSignal.timeout must cap the request
    });
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
    const addr = hang.address();
    const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const started = Date.now();
    await expect(revokeToken(url, 'at', 50)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
    hang.closeAllConnections();
    hang.close();
  });
});
