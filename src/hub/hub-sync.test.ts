import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./auth.js', () => ({
  readAuth: vi.fn(),
  saveAuth: vi.fn(),
}));

vi.mock('./hub-client.js', () => ({
  createHubClient: vi.fn(),
}));

vi.mock('./hub-ws.js', () => ({
  createHubWs: vi.fn(),
}));

vi.mock('./reconnection.js', () => ({
  createReconnector: vi.fn(),
}));

vi.mock('../daemon/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  getDefaultVaultsDir: vi.fn(() => '/tmp/test-vaults-default'),
}));

vi.mock('../daemon/routes.js', () => ({
  getAgents: vi.fn(),
}));

vi.mock('../daemon/run-manager.js', () => ({
  cancelRun: vi.fn(),
  sendInput: vi.fn(),
  getRuns: vi.fn(),
}));

vi.mock('../utils/version.js', () => ({
  VERSION: '0.7.1',
}));

vi.mock('../projects/projects.js', () => ({
  loadProjects: vi.fn(),
}));

vi.mock('../daemon/actions.js', () => ({
  getActionRegistry: vi.fn(() => ({ list: () => [] })),
}));

vi.mock('../vaults/instance.js', () => ({
  getVaultRegistry: vi.fn(() => ({ metadata: async () => [] })),
}));

vi.mock('../daemon/metrics.js', () => ({
  collectMachineMetrics: vi.fn().mockResolvedValue({
    cpuUsage: 12.3,
    cpuCount: 8,
    memoryUsedMb: 4096,
    memoryTotalMb: 16384,
    diskUsedMb: 100000,
    diskTotalMb: 500000,
    loadAvg1m: 0.5,
    loadAvg5m: 0.7,
    loadAvg15m: 0.9,
  }),
}));

import { readAuth } from './auth.js';
import { createHubClient } from './hub-client.js';
import { createHubWs } from './hub-ws.js';
import { createReconnector } from './reconnection.js';
import { loadConfig } from '../daemon/config.js';
import { getAgents } from '../daemon/routes.js';
import { cancelRun, sendInput, getRuns } from '../daemon/run-manager.js';
import { loadProjects } from '../projects/projects.js';
import { createHubSync, resetHubSync, getHubSync } from './hub-sync.js';

const mockLoadProjects = vi.mocked(loadProjects);

const mockReadAuth = vi.mocked(readAuth);
const mockCreateHubClient = vi.mocked(createHubClient);
const mockCreateHubWs = vi.mocked(createHubWs);
const mockCreateReconnector = vi.mocked(createReconnector);
const mockLoadConfig = vi.mocked(loadConfig);
const mockGetAgents = vi.mocked(getAgents);
const mockGetRuns = vi.mocked(getRuns);
const mockCancelRun = vi.mocked(cancelRun);
const mockSendInput = vi.mocked(sendInput);

const testAuth = {
  session: { access_token: 'tk', refresh_token: 'rt', expires_at: 9999 },
  user: { id: 'u1', email: 'v@test.com' },
  hub: { url: 'https://hub.test', machineId: 'machine-1' },
};

const testConfig = {
  machine: { id: 'machine-1', name: 'test-pc' },
  daemon: { port: 4243 },
  agents: { default: '/tmp/agents', additional: [] },
  projects: { default: '/tmp/projects', additional: [] },
};

describe('hub-sync', () => {
  let mockHubClient: {
    register: ReturnType<typeof vi.fn>;
    heartbeat: ReturnType<typeof vi.fn>;
    deregister: ReturnType<typeof vi.fn>;
  };
  let mockWs: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let mockReconnector: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let capturedOnConnect: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockHubClient = {
      register: vi.fn().mockResolvedValue({ machineId: 'machine-1' }),
      heartbeat: vi.fn().mockResolvedValue({ pendingCommands: [] }),
      deregister: vi.fn().mockResolvedValue(undefined),
    };

    mockWs = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockReconnector = {
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockCreateHubClient.mockReturnValue(
      mockHubClient as unknown as ReturnType<typeof createHubClient>
    );
    capturedOnConnect = undefined;
    mockCreateHubWs.mockImplementation((_url, _token, _machineId, _onDisconnect, onConnect) => {
      capturedOnConnect = onConnect;
      return mockWs as unknown as ReturnType<typeof createHubWs>;
    });
    mockCreateReconnector.mockReturnValue(
      mockReconnector as unknown as ReturnType<typeof createReconnector>
    );
    mockLoadConfig.mockReturnValue({ ...testConfig, sync: { events: {} } } as unknown as ReturnType<
      typeof loadConfig
    >);
    mockGetAgents.mockReturnValue([]);
    mockGetRuns.mockReturnValue([]);
    mockLoadProjects.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('skips connection when no auth (standalone mode)', async () => {
      mockReadAuth.mockReturnValue(null);
      const sync = createHubSync();

      await sync.start();

      expect(mockCreateHubClient).not.toHaveBeenCalled();
      expect(sync.isConnected()).toBe(false);
    });

    it('connects to hub when auth is present', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      const sync = createHubSync();

      await sync.start();

      expect(mockHubClient.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'machine-1', name: 'test-pc' })
      );
      expect(mockWs.connect).toHaveBeenCalled();
      expect(sync.isConnecting()).toBe(true);
      expect(sync.isConnected()).toBe(false);

      // Simulate WS open event
      capturedOnConnect?.();
      expect(sync.isConnected()).toBe(true);
      expect(sync.isConnecting()).toBe(false);
    });

    it('starts reconnection on initial connection failure', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockHubClient.register.mockRejectedValue(new Error('Network error'));
      const sync = createHubSync();

      await sync.start();

      expect(mockReconnector.start).toHaveBeenCalled();
      expect(sync.isConnected()).toBe(false);
    });
  });

  describe('stop', () => {
    it('cleans up all connections', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      const sync = createHubSync();
      await sync.start();
      capturedOnConnect?.();

      await sync.stop();

      expect(mockWs.disconnect).toHaveBeenCalled();
      expect(mockReconnector.stop).toHaveBeenCalled();
      expect(mockHubClient.deregister).toHaveBeenCalledWith('machine-1');
      expect(sync.isConnected()).toBe(false);
    });
  });

  describe('heartbeat', () => {
    it('sends agents, projects, and active runs in heartbeat', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockGetAgents.mockReturnValue([
        { manifest: { name: 'hello', description: 'Hi', version: '1.0', tags: ['chat'] } },
      ] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([
        { id: 'run-1', state: 'working' },
        { id: 'run-2', state: 'completed' },
      ] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([
        { name: 'proj-a', path: '/home/user/proj-a', discovered: false },
        {
          name: 'proj-b',
          path: '/home/user/proj-b',
          discovered: true,
          remote: 'https://github.com/example/proj-b.git',
        },
      ]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      expect(mockHubClient.heartbeat).toHaveBeenCalledWith('machine-1', {
        agents: [{ name: 'hello', description: 'Hi', version: '1.0', tags: ['chat'] }],
        projects: [
          { name: 'proj-a', path: '/home/user/proj-a', discovered: false },
          {
            name: 'proj-b',
            path: '/home/user/proj-b',
            discovered: true,
            remote: 'https://github.com/example/proj-b.git',
          },
        ],
        activeRunIds: ['run-1'],
        daemonVersion: '0.7.1',
        agentsDefault: '/tmp/agents',
        projectsDefault: '/tmp/projects',
        vaultsDefault: '/tmp/test-vaults-default',
        actions: [],
        resources: {
          cpuUsage: 12.3,
          cpuCount: 8,
          memoryUsedMb: 4096,
          memoryTotalMb: 16384,
          diskUsedMb: 100000,
          diskTotalMb: 500000,
          loadAvg1m: 0.5,
          loadAvg5m: 0.7,
          loadAvg15m: 0.9,
        },
      });
    });

    it('omits vaults key when no vaults registered', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockGetAgents.mockReturnValue([] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      const call = mockHubClient.heartbeat.mock.calls[0][1] as Record<string, unknown>;
      expect(call.vaults).toBeUndefined();
    });

    it('includes vault metadata in heartbeat when vaults registered', async () => {
      const { getVaultRegistry } = await import('../vaults/instance.js');
      vi.mocked(getVaultRegistry).mockReturnValueOnce({
        metadata: async () => [
          {
            slug: 'notes',
            uuid: 'b6377f6d-ae6e-40b6-9435-48f3414374ed',
            path: '/home/u/notes',
            fileCount: 42,
            indexedAt: '2026-04-25T01:19:33.453Z',
          },
        ],
      } as unknown as ReturnType<typeof getVaultRegistry>);

      mockReadAuth.mockReturnValue(testAuth);
      mockGetAgents.mockReturnValue([] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      const call = mockHubClient.heartbeat.mock.calls[0][1] as {
        vaults?: Array<Record<string, unknown>>;
      };
      expect(call.vaults).toEqual([
        {
          slug: 'notes',
          uuid: 'b6377f6d-ae6e-40b6-9435-48f3414374ed',
          path: '/home/u/notes',
          fileCount: 42,
          indexedAt: '2026-04-25T01:19:33.453Z',
        },
      ]);
    });

    it('includes daemon action capabilities in heartbeat payload', async () => {
      const { getActionRegistry } = await import('../daemon/actions.js');
      vi.mocked(getActionRegistry).mockReturnValue({
        list: () => [
          {
            name: 'cli:update' as const,
            version: '1.0',
            title: 'Update CLI',
            description: 'Reinstall daemon globally',
            scope: 'machine',
            capability: 'cli.write',
            idempotent: false,
          },
        ],
      } as unknown as ReturnType<typeof getActionRegistry>);

      mockReadAuth.mockReturnValue(testAuth);
      mockGetAgents.mockReturnValue([] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      const call = mockHubClient.heartbeat.mock.calls[0][1] as {
        actions: Array<Record<string, unknown>>;
      };
      expect(call.actions).toEqual([
        {
          name: 'cli:update',
          version: '1.0',
          title: 'Update CLI',
          description: 'Reinstall daemon globally',
          scope: 'machine',
          capability: 'cli.write',
          idempotent: false,
        },
      ]);
    });

    it('includes inputSchema in agent payload when declared', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      const schema = {
        type: 'object',
        properties: { prUrl: { type: 'string' } },
        required: ['prUrl'],
      };
      mockGetAgents.mockReturnValue([
        { manifest: { name: 'pr-reviewer', inputSchema: schema } },
        { manifest: { name: 'pr-list' } },
      ] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      const call = mockHubClient.heartbeat.mock.calls[0][1] as {
        agents: Array<Record<string, unknown>>;
      };
      expect(call.agents[0]).toMatchObject({ name: 'pr-reviewer', inputSchema: schema });
      expect(call.agents[1]).not.toHaveProperty('inputSchema');
    });

    it('includes outputSchema in agent payload when declared', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      const outputSchema = {
        type: 'object',
        properties: { verdict: { type: 'string' } },
        required: ['verdict'],
      };
      mockGetAgents.mockReturnValue([
        { manifest: { name: 'pr-reviewer', outputSchema } },
        { manifest: { name: 'pr-list' } },
      ] as ReturnType<typeof getAgents>);
      mockGetRuns.mockReturnValue([] as ReturnType<typeof getRuns>);
      mockLoadProjects.mockReturnValue([]);

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      const call = mockHubClient.heartbeat.mock.calls[0][1] as {
        agents: Array<Record<string, unknown>>;
      };
      expect(call.agents[0]).toMatchObject({ name: 'pr-reviewer', outputSchema });
      expect(call.agents[1]).not.toHaveProperty('outputSchema');
    });

    it('processes pending cancel commands', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockHubClient.heartbeat.mockResolvedValue({
        pendingCommands: [{ type: 'cancel', runId: 'run-1' }],
      });

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      expect(mockCancelRun).toHaveBeenCalledWith('run-1');
    });

    it('processes pending input commands', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockHubClient.heartbeat.mockResolvedValue({
        pendingCommands: [{ type: 'input', runId: 'run-1', payload: 'yes' }],
      });

      const sync = createHubSync();
      await sync.start();
      await sync.triggerHeartbeat();

      expect(mockSendInput).toHaveBeenCalledWith('run-1', 'yes');
    });

    it('handles heartbeat failure gracefully', async () => {
      mockReadAuth.mockReturnValue(testAuth);
      mockHubClient.heartbeat.mockRejectedValue(new Error('timeout'));

      const sync = createHubSync();
      await sync.start();

      // Should not throw
      await sync.triggerHeartbeat();
    });
  });

  describe('singleton', () => {
    it('getHubSync returns same instance', () => {
      resetHubSync();
      const a = getHubSync();
      const b = getHubSync();
      expect(a).toBe(b);
    });

    it('resetHubSync creates new instance', () => {
      const a = getHubSync();
      resetHubSync();
      const b = getHubSync();
      expect(a).not.toBe(b);
    });
  });
});
