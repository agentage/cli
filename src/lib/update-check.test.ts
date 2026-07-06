import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, evaluateUpdate, fetchCliLatest, type CliLatest } from './update-check.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('0.0.1', '0.0.1')).toBe(0);
    expect(compareVersions('0.0.1', '0.0.2')).toBe(-1);
    expect(compareVersions('0.1.0', '0.0.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1); // numeric, not lexical
  });

  it('ignores prerelease/build suffixes and missing parts', () => {
    expect(compareVersions('0.1.0-rc.1', '0.1.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });
});

describe('fetchCliLatest', () => {
  it('reads .version from the npm registry (no server floor or notice)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { name: '@agentage/cli', version: '0.2.0' }))
    );
    expect(await fetchCliLatest()).toEqual({
      version: '0.2.0',
      minSupported: '0.0.0',
      message: null,
    });
  });

  it('hits the public npm registry with a JSON Accept header', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { version: '0.2.0' })
    );
    vi.stubGlobal('fetch', spy);
    await fetchCliLatest();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://registry.npmjs.org/@agentage/cli/latest');
    expect(init?.headers).toMatchObject({ Accept: 'application/json' });
  });

  it('returns null on a non-2xx, a throw, or a body without a version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, {}))
    );
    expect(await fetchCliLatest()).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    expect(await fetchCliLatest()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { nope: true }))
    );
    expect(await fetchCliLatest()).toBeNull();
  });
});

describe('evaluateUpdate', () => {
  const latest = (over: Partial<CliLatest> = {}): CliLatest => ({
    version: '0.2.0',
    minSupported: '0.1.0',
    message: null,
    ...over,
  });

  it('unknown when the endpoint was unreachable', () => {
    expect(evaluateUpdate('0.1.0', null)).toEqual({ status: { kind: 'unknown' }, message: null });
  });

  it('unsupported when below the floor (and carries the notice)', () => {
    expect(evaluateUpdate('0.0.5', latest({ message: 'EOL' }))).toEqual({
      status: { kind: 'unsupported', latest: '0.2.0', minSupported: '0.1.0' },
      message: 'EOL',
    });
  });

  it('update-available when below latest but at/above the floor', () => {
    expect(evaluateUpdate('0.1.0', latest()).status).toEqual({
      kind: 'update-available',
      latest: '0.2.0',
    });
  });

  it('current when at the latest', () => {
    expect(evaluateUpdate('0.2.0', latest()).status).toEqual({ kind: 'current' });
  });

  it('current when ahead of latest (local dev build)', () => {
    expect(evaluateUpdate('0.3.0', latest()).status).toEqual({ kind: 'current' });
  });

  it('current when the registry version is unknown but the floor is met', () => {
    expect(evaluateUpdate('0.1.0', latest({ version: null })).status).toEqual({ kind: 'current' });
  });
});
