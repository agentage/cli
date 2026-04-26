import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { type Server } from 'node:http';

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getVaultStorageDir: vi.fn(() => '/tmp/agentage-routes-test-vaults'),
}));

vi.mock('./metrics.js', () => ({
  collectMachineMetrics: vi.fn(),
}));

vi.mock('./run-manager.js', () => ({
  startRun: vi.fn(),
  getRun: vi.fn(),
  getRuns: vi.fn(),
  cancelRun: vi.fn(),
  sendInput: vi.fn(),
}));

vi.mock('../hub/hub-sync.js', () => ({
  getHubSync: vi.fn(),
}));

vi.mock('../hub/auth.js', () => ({
  readAuth: vi.fn(),
}));

vi.mock('../hub/hub-client.js', () => ({
  createHubClient: vi.fn(),
}));

vi.mock('../utils/version.js', () => ({
  VERSION: '0.7.1',
}));

vi.mock('../projects/projects.js', () => ({
  loadProjects: vi.fn(),
}));

import { loadConfig } from './config.js';
import { collectMachineMetrics } from './metrics.js';
import { startRun, getRun, getRuns, cancelRun, sendInput } from './run-manager.js';
import { getHubSync } from '../hub/hub-sync.js';
import { readAuth } from '../hub/auth.js';
import { createHubClient } from '../hub/hub-client.js';
import { loadProjects } from '../projects/projects.js';
import { createRoutes, setAgents, setRefreshHandler } from './routes.js';

const mockLoadProjects = vi.mocked(loadProjects);

const mockLoadConfig = vi.mocked(loadConfig);
const mockCollectMachineMetrics = vi.mocked(collectMachineMetrics);
const mockGetRuns = vi.mocked(getRuns);
const mockGetRun = vi.mocked(getRun);
const mockStartRun = vi.mocked(startRun);
const mockCancelRun = vi.mocked(cancelRun);
const mockSendInput = vi.mocked(sendInput);
const mockGetHubSync = vi.mocked(getHubSync);
const mockReadAuth = vi.mocked(readAuth);
const mockCreateHubClient = vi.mocked(createHubClient);

const request = async (
  server: Server,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> }> => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
};

describe('daemon routes', () => {
  let server: Server;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockLoadConfig.mockReturnValue({
      machine: { id: 'machine-1', name: 'test-pc' },
      daemon: { port: 4243 },
      agents: { default: '/tmp/agents', additional: [] },
      projects: { default: '/tmp/projects', additional: [] },
      sync: { events: {} },
    } as unknown as ReturnType<typeof loadConfig>);

    mockGetHubSync.mockReturnValue({
      isConnected: () => false,
      isConnecting: () => false,
      isAuthExpired: () => false,
      start: vi.fn(),
      stop: vi.fn(),
      triggerHeartbeat: vi.fn().mockResolvedValue(undefined),
    });

    mockReadAuth.mockReturnValue(null);
    mockGetRuns.mockReturnValue([]);
    mockLoadProjects.mockReturnValue([]);
    setAgents([]);

    const app = express();
    app.use(createRoutes());
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('GET /api/health', () => {
    it('returns health status', async () => {
      const { status, data } = await request(server, 'GET', '/api/health');

      expect(status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.version).toBe('0.7.1');
      expect(data.machineId).toBe('machine-1');
      expect(data.hubConnected).toBe(false);
      expect(typeof data.uptime).toBe('number');
    });
  });

  describe('GET /api/metrics', () => {
    it('returns machine metrics from collector', async () => {
      mockCollectMachineMetrics.mockResolvedValueOnce({
        cpuUsage: 12.3,
        cpuCount: 8,
        memoryUsedMb: 5000,
        memoryTotalMb: 16000,
        diskUsedMb: 200000,
        diskTotalMb: 500000,
        loadAvg1m: 0.5,
        loadAvg5m: 0.4,
        loadAvg15m: 0.3,
      });

      const { status, data } = await request(server, 'GET', '/api/metrics');

      expect(status).toBe(200);
      expect(data).toEqual({
        cpuUsage: 12.3,
        cpuCount: 8,
        memoryUsedMb: 5000,
        memoryTotalMb: 16000,
        diskUsedMb: 200000,
        diskTotalMb: 500000,
        loadAvg1m: 0.5,
        loadAvg5m: 0.4,
        loadAvg15m: 0.3,
      });
    });

    it('returns 500 when collector fails', async () => {
      mockCollectMachineMetrics.mockRejectedValueOnce(new Error('boom'));

      const { status, data } = await request(server, 'GET', '/api/metrics');

      expect(status).toBe(500);
      expect(data).toEqual({ error: 'boom' });
    });
  });

  describe('GET /api/agents', () => {
    it('returns agent manifests', async () => {
      setAgents([{ manifest: { name: 'hello', description: 'Hi', path: '/test' } }] as Parameters<
        typeof setAgents
      >[0]);

      const { status, data } = await request(server, 'GET', '/api/agents');

      expect(status).toBe(200);
      expect(data).toEqual([{ name: 'hello', description: 'Hi', path: '/test' }]);
    });
  });

  describe('POST /api/agents/refresh', () => {
    it('rescans agents and returns manifests', async () => {
      setRefreshHandler(async () => {
        const newAgents = [
          { manifest: { name: 'refreshed', description: 'New', path: '/new' } },
        ] as Parameters<typeof setAgents>[0];
        return newAgents;
      });

      const { status, data } = await request(server, 'POST', '/api/agents/refresh');

      expect(status).toBe(200);
      expect(data).toEqual([{ name: 'refreshed', description: 'New', path: '/new' }]);
    });
  });

  describe('POST /api/agents/:name/run', () => {
    it('starts an agent run', async () => {
      setAgents([
        {
          manifest: { name: 'hello', description: 'Hi', path: '/test' },
          run: vi.fn(),
        },
      ] as Parameters<typeof setAgents>[0]);
      mockStartRun.mockResolvedValue('run-new-123');

      const { status, data } = await request(server, 'POST', '/api/agents/hello/run', {
        task: 'say hi',
      });

      expect(status).toBe(200);
      expect(data.runId).toBe('run-new-123');
    });

    it('accepts missing task when inputSchema does not list task as required', async () => {
      setAgents([
        {
          manifest: {
            name: 'no-task',
            description: 'Needs no task',
            path: '/test',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
          run: vi.fn(),
        },
      ] as Parameters<typeof setAgents>[0]);
      mockStartRun.mockResolvedValue('run-empty-1');

      const { status, data } = await request(server, 'POST', '/api/agents/no-task/run', {});

      expect(status).toBe(200);
      expect(data.runId).toBe('run-empty-1');
    });

    it('rejects missing task when inputSchema lists task as required', async () => {
      setAgents([
        {
          manifest: {
            name: 'needs-task',
            description: 'Requires task',
            path: '/test',
            inputSchema: {
              type: 'object',
              properties: { task: { type: 'string' } },
              required: ['task'],
            },
          },
          run: vi.fn(),
        },
      ] as Parameters<typeof setAgents>[0]);

      const { status } = await request(server, 'POST', '/api/agents/needs-task/run', {});

      expect(status).toBe(400);
    });

    it('returns 404 when agent not found', async () => {
      const { status, data } = await request(server, 'POST', '/api/agents/missing/run', {
        task: 'hi',
      });

      expect(status).toBe(404);
      expect(data.error).toContain('missing');
    });

    it('passes project to startRun', async () => {
      setAgents([
        {
          manifest: { name: 'hello', description: 'Hi', path: '/test' },
          run: vi.fn(),
        },
      ] as Parameters<typeof setAgents>[0]);
      mockStartRun.mockResolvedValue('run-proj-1');

      const project = { name: 'my-project', path: '/home/user/my-project', branch: 'main' };
      const { status, data } = await request(server, 'POST', '/api/agents/hello/run', {
        task: 'build it',
        project,
      });

      expect(status).toBe(200);
      expect(data.runId).toBe('run-proj-1');
      expect(mockStartRun).toHaveBeenCalledWith(
        expect.objectContaining({ manifest: expect.objectContaining({ name: 'hello' }) }),
        'build it',
        undefined,
        undefined,
        project
      );
    });
  });

  describe('GET /api/projects', () => {
    it('returns the project list', async () => {
      mockLoadProjects.mockReturnValue([
        { name: 'proj-a', path: '/home/user/proj-a', discovered: false },
        { name: 'proj-b', path: '/home/user/proj-b', discovered: true },
      ]);

      const { status, data } = await request(server, 'GET', '/api/projects');

      expect(status).toBe(200);
      expect(data).toEqual([
        { name: 'proj-a', path: '/home/user/proj-a', discovered: false },
        { name: 'proj-b', path: '/home/user/proj-b', discovered: true },
      ]);
    });
  });

  describe('GET /api/runs', () => {
    it('returns all runs', async () => {
      mockGetRuns.mockReturnValue([{ id: 'run-1', state: 'working' }] as ReturnType<
        typeof getRuns
      >);

      const { status, data } = await request(server, 'GET', '/api/runs');

      expect(status).toBe(200);
      expect(data).toEqual([{ id: 'run-1', state: 'working' }]);
    });
  });

  describe('GET /api/runs/:id', () => {
    it('returns a run by id', async () => {
      mockGetRun.mockReturnValue({ id: 'run-1', state: 'completed' } as ReturnType<typeof getRun>);

      const { status, data } = await request(server, 'GET', '/api/runs/run-1');

      expect(status).toBe(200);
      expect(data.id).toBe('run-1');
    });

    it('returns 404 when run not found', async () => {
      mockGetRun.mockReturnValue(undefined as ReturnType<typeof getRun>);

      const { status } = await request(server, 'GET', '/api/runs/missing');

      expect(status).toBe(404);
    });
  });

  describe('POST /api/runs/:id/cancel', () => {
    it('cancels a run', async () => {
      mockCancelRun.mockReturnValue(true);

      const { status, data } = await request(server, 'POST', '/api/runs/run-1/cancel');

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it('returns 400 when cancel fails', async () => {
      mockCancelRun.mockReturnValue(false);

      const { status } = await request(server, 'POST', '/api/runs/run-1/cancel');

      expect(status).toBe(400);
    });
  });

  describe('POST /api/runs/:id/input', () => {
    it('sends input to a run', async () => {
      mockSendInput.mockReturnValue(true);

      const { status, data } = await request(server, 'POST', '/api/runs/run-1/input', {
        text: 'hello',
      });

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it('returns 400 when text is missing', async () => {
      const { status } = await request(server, 'POST', '/api/runs/run-1/input', {});

      expect(status).toBe(400);
    });

    it('returns 400 when sendInput fails', async () => {
      mockSendInput.mockReturnValue(false);

      const { status } = await request(server, 'POST', '/api/runs/run-1/input', {
        text: 'hello',
      });

      expect(status).toBe(400);
    });
  });

  describe('hub proxy routes', () => {
    it('returns 401 for hub routes when not logged in', async () => {
      mockReadAuth.mockReturnValue(null);

      const { status, data } = await request(server, 'GET', '/api/hub/machines');

      expect(status).toBe(401);
      expect(data.error).toContain('Not logged in');
    });

    it('proxies GET /api/hub/machines', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getMachines: vi.fn().mockResolvedValue([{ id: 'm1', name: 'pc' }]),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'GET', '/api/hub/machines');

      expect(status).toBe(200);
      expect(data).toEqual([{ id: 'm1', name: 'pc' }]);
    });

    it('returns 502 when hub proxy fails', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getMachines: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'GET', '/api/hub/machines');

      expect(status).toBe(502);
      expect(data.error).toContain('Connection refused');
    });

    it('proxies POST /api/hub/runs', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        createRun: vi.fn().mockResolvedValue({ runId: 'hub-run-1' }),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'POST', '/api/hub/runs', {
        machineId: 'm1',
        agentName: 'hello',
        input: 'hi',
      });

      expect(status).toBe(200);
      expect(data.runId).toBe('hub-run-1');
    });

    it('returns 401 for GET /api/hub/agents when not logged in', async () => {
      mockReadAuth.mockReturnValue(null);
      const { status } = await request(server, 'GET', '/api/hub/agents');
      expect(status).toBe(401);
    });

    it('proxies GET /api/hub/agents', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getAgents: vi.fn().mockResolvedValue([{ name: 'agent1' }]),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'GET', '/api/hub/agents');
      expect(status).toBe(200);
      expect(data).toEqual([{ name: 'agent1' }]);
    });

    it('proxies GET /api/hub/agents with machine filter', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      const mockGetAgents = vi.fn().mockResolvedValue([]);
      mockCreateHubClient.mockReturnValue({
        getAgents: mockGetAgents,
      } as unknown as ReturnType<typeof createHubClient>);

      await request(server, 'GET', '/api/hub/agents?machine=m1');
      expect(mockGetAgents).toHaveBeenCalledWith('m1');
    });

    it('returns 401 for GET /api/hub/runs/:id when not logged in', async () => {
      mockReadAuth.mockReturnValue(null);
      const { status } = await request(server, 'GET', '/api/hub/runs/run-1');
      expect(status).toBe(401);
    });

    it('proxies GET /api/hub/runs/:id', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getRun: vi.fn().mockResolvedValue({ id: 'run-1', state: 'working' }),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'GET', '/api/hub/runs/run-1');
      expect(status).toBe(200);
      expect(data.id).toBe('run-1');
    });

    it('returns 401 for GET /api/hub/runs/:id/events when not logged in', async () => {
      mockReadAuth.mockReturnValue(null);
      const { status } = await request(server, 'GET', '/api/hub/runs/run-1/events');
      expect(status).toBe(401);
    });

    it('proxies GET /api/hub/runs/:id/events', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getRunEvents: vi.fn().mockResolvedValue([{ type: 'output', data: 'hi' }]),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status, data } = await request(server, 'GET', '/api/hub/runs/run-1/events');
      expect(status).toBe(200);
      expect(data).toEqual([{ type: 'output', data: 'hi' }]);
    });

    it('proxies GET /api/hub/runs/:id/events with after param', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      const mockGetRunEvents = vi.fn().mockResolvedValue([]);
      mockCreateHubClient.mockReturnValue({
        getRunEvents: mockGetRunEvents,
      } as unknown as ReturnType<typeof createHubClient>);

      await request(server, 'GET', '/api/hub/runs/run-1/events?after=2026-01-01');
      expect(mockGetRunEvents).toHaveBeenCalledWith('run-1', '2026-01-01');
    });

    it('returns 401 for POST /api/hub/runs when not logged in', async () => {
      mockReadAuth.mockReturnValue(null);
      const { status } = await request(server, 'POST', '/api/hub/runs', {
        machineId: 'm1',
        agentName: 'hello',
        input: 'hi',
      });
      expect(status).toBe(401);
    });

    it('returns 502 for hub agent proxy failure', async () => {
      const auth = {
        session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.test', machineId: 'machine-1' },
      };
      mockReadAuth.mockReturnValue(auth);
      mockCreateHubClient.mockReturnValue({
        getAgents: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as ReturnType<typeof createHubClient>);

      const { status } = await request(server, 'GET', '/api/hub/agents');
      expect(status).toBe(502);
    });
  });
});
