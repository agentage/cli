import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./auth.js', () => ({
  saveAuth: vi.fn(),
}));

vi.mock('../daemon/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { saveAuth } from './auth.js';
import { createHubClient, type HubClient } from './hub-client.js';
import { type AuthState } from './auth.js';

const mockSaveAuth = vi.mocked(saveAuth);

const makeAuth = (overrides?: Partial<AuthState>): AuthState => ({
  session: { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 9999 },
  user: { id: 'u1', email: 'v@test.com' },
  hub: { url: 'https://hub.test', machineId: 'machine-1' },
  ...overrides,
});

describe('hub-client', () => {
  let client: HubClient;
  let auth: AuthState;

  beforeEach(() => {
    vi.clearAllMocks();
    auth = makeAuth();
    client = createHubClient('https://hub.test', auth);
  });

  const mockFetch = (data: unknown, ok = true, status = 200) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok,
        status,
        json: async () => ({ success: ok, data }),
      })
    );
  };

  const mockFetchError = (error: string, status = 400) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ success: false, error }),
      })
    );
  };

  describe('register', () => {
    it('POSTs machine data and returns machineId', async () => {
      mockFetch({ machineId: 'new-machine-1' });

      const result = await client.register({
        id: 'm1',
        name: 'test-pc',
        platform: 'linux',
        arch: 'x64',
        daemonVersion: '0.7.1',
      });

      expect(result.machineId).toBe('new-machine-1');
      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/machines',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('heartbeat', () => {
    it('sends agents and active runs', async () => {
      mockFetch({ pendingCommands: [] });

      const result = await client.heartbeat('machine-1', {
        agents: [{ name: 'hello', description: 'Hi' }],
        activeRunIds: ['run-1'],
      });

      expect(result.pendingCommands).toEqual([]);
      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/machines/machine-1/heartbeat',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('deregister', () => {
    it('DELETEs machine', async () => {
      mockFetch(null);

      await client.deregister('machine-1');

      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/machines/machine-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('getMachines', () => {
    it('GETs machine list', async () => {
      mockFetch([{ id: 'm1', name: 'pc' }]);

      const result = await client.getMachines();

      expect(result).toEqual([{ id: 'm1', name: 'pc' }]);
    });
  });

  describe('getAgents', () => {
    it('GETs all agents when no machineId', async () => {
      mockFetch([{ name: 'agent1' }]);

      await client.getAgents();

      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/agents',
        expect.anything()
      );
    });

    it('GETs agents filtered by machineId', async () => {
      mockFetch([]);

      await client.getAgents('m1');

      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/agents?machine=m1',
        expect.anything()
      );
    });
  });

  describe('run management', () => {
    it('creates a run', async () => {
      mockFetch({ runId: 'run-new' });

      const result = await client.createRun('m1', 'hello', 'do something');

      expect(result).toEqual({ runId: 'run-new' });
    });

    it('cancels a run', async () => {
      mockFetch(null);

      await client.cancelRun('run-1');

      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/runs/run-1/cancel',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends input to a run', async () => {
      mockFetch(null);

      await client.sendRunInput('run-1', 'hello');

      expect(fetch).toHaveBeenCalledWith(
        'https://hub.test/api/runs/run-1/input',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('gets a run by id', async () => {
      mockFetch({ id: 'run-1', state: 'completed' });

      const result = await client.getRun('run-1');

      expect(result).toEqual({ id: 'run-1', state: 'completed' });
    });

    it('gets run events', async () => {
      mockFetch([{ type: 'output', data: 'hello' }]);

      const events = await client.getRunEvents('run-1');

      expect(events).toHaveLength(1);
    });

    it('gets run events with after param', async () => {
      mockFetch([]);

      await client.getRunEvents('run-1', '2026-01-01T00:00:00Z');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('after=2026-01-01T00:00:00Z'),
        expect.anything()
      );
    });
  });

  describe('error handling', () => {
    it('throws formatted error on API failure', async () => {
      mockFetchError('Forbidden', 403);

      await expect(client.getMachines()).rejects.toThrow('Hub API error (403): Forbidden');
    });

    it('handles object error with message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: { message: 'Internal failure' } }),
        })
      );

      await expect(client.getMachines()).rejects.toThrow('Hub API error (500): Internal failure');
    });
  });

  describe('token refresh on 401', () => {
    it('retries request after successful token refresh', async () => {
      const fetchMock = vi
        .fn()
        // First call: 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Unauthorized' }),
        })
        // Health endpoint for refresh
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: { supabaseUrl: 'https://supa.test', supabaseAnonKey: 'anon-key' },
          }),
        })
        // Supabase token refresh
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'new-token',
            refresh_token: 'new-refresh',
            expires_at: 99999,
          }),
        })
        // Retry original request
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [{ id: 'm1' }] }),
        });

      vi.stubGlobal('fetch', fetchMock);

      const result = await client.getMachines();

      expect(result).toEqual([{ id: 'm1' }]);
      expect(mockSaveAuth).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('does not refresh when no refresh_token', async () => {
      auth = makeAuth({ session: { access_token: 'tk', refresh_token: '', expires_at: 0 } });
      client = createHubClient('https://hub.test', auth);

      mockFetchError('Unauthorized', 401);

      await expect(client.getMachines()).rejects.toThrow('Hub API error (401)');
    });
  });
});
