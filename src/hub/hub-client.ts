import { type AuthState, saveAuth } from './auth.js';
import { logInfo, logWarn } from '../daemon/logger.js';

export interface HubClient {
  register: (machineData: {
    id: string;
    name: string;
    platform: string;
    arch: string;
    daemonVersion: string;
  }) => Promise<{ machineId: string }>;
  heartbeat: (
    machineId: string,
    data: {
      agents: Array<{
        name: string;
        description?: string;
        version?: string;
        tags?: string[];
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
      }>;
      projects?: Array<{ name: string; path: string; discovered?: boolean; remote?: string }>;
      activeRunIds: string[];
      daemonVersion: string;
      agentsDefault?: string;
      projectsDefault?: string;
      vaultsDefault?: string;
      actions?: Array<{
        name: string;
        version: string;
        title: string;
        description: string;
        scope: 'machine' | 'hub' | 'project';
        capability: string;
        idempotent: boolean;
        inputSchema?: Record<string, unknown>;
        deprecatedSince?: string;
      }>;
      vaults?: Array<{
        slug: string;
        uuid: string;
        path: string;
        fileCount: number;
        indexedAt: string | null;
      }>;
      resources?: {
        cpuUsage?: number;
        cpuCount?: number;
        memoryUsedMb?: number;
        memoryTotalMb?: number;
        diskUsedMb?: number;
        diskTotalMb?: number;
        loadAvg1m?: number;
        loadAvg5m?: number;
        loadAvg15m?: number;
      };
    }
  ) => Promise<{
    pendingCommands: unknown[];
    latestCliVersion?: string;
    schedules?: Array<{
      id: string;
      agentName: string;
      cron: string;
      timezone: string;
      nextFireAt: string;
      missedFire: 'skip' | 'run_once';
      concurrency: 'skip' | 'queue';
    }>;
  }>;
  fireSchedule: (
    scheduleId: string,
    expectedNextFireAt: string
  ) => Promise<{ acquired: boolean; runId?: string; nextFireAt: string }>;
  deregister: (machineId: string) => Promise<void>;
  getMachines: () => Promise<unknown[]>;
  getAgents: (machineId?: string) => Promise<unknown[]>;
  createRun: (machineId: string, agentName: string, input: string) => Promise<unknown>;
  cancelRun: (runId: string) => Promise<void>;
  sendRunInput: (runId: string, text: string) => Promise<void>;
  getRun: (runId: string) => Promise<unknown>;
  getRunEvents: (runId: string, after?: string) => Promise<unknown[]>;
  getSchedules: (filters?: { machineId?: string; enabled?: boolean }) => Promise<unknown[]>;
  createSchedule: (input: {
    machineId: string;
    agentName: string;
    cron: string;
    timezone?: string;
    name?: string;
    input?: Record<string, unknown>;
  }) => Promise<unknown>;
  updateSchedule: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  deleteSchedule: (id: string) => Promise<void>;
  runScheduleNow: (id: string) => Promise<{ runId: string }>;
}

const refreshAccessToken = async (hubUrl: string, auth: AuthState): Promise<boolean> => {
  if (!auth.session.refresh_token) return false;

  try {
    const healthRes = await fetch(`${hubUrl}/api/health`);
    const health = (await healthRes.json()) as {
      success: boolean;
      data: { supabaseUrl: string; supabaseAnonKey: string };
    };

    const res = await fetch(`${health.data.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: health.data.supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: auth.session.refresh_token }),
    });

    if (!res.ok) return false;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };

    auth.session.access_token = data.access_token;
    auth.session.refresh_token = data.refresh_token;
    auth.session.expires_at = data.expires_at;
    saveAuth(auth);

    logInfo('Token refreshed successfully');
    return true;
  } catch {
    logWarn('Token refresh failed');
    return false;
  }
};

export const createHubClient = (hubUrl: string, auth: AuthState): HubClient => {
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.session.access_token}`,
  });

  const apiUrl = `${hubUrl}/api`;

  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-refresh on 401
    if (res.status === 401) {
      const refreshed = await refreshAccessToken(hubUrl, auth);
      if (refreshed) {
        res = await fetch(`${apiUrl}${path}`, {
          method,
          headers: headers(),
          body: body ? JSON.stringify(body) : undefined,
        });
      }
    }

    const json = (await res.json()) as { success: boolean; data?: unknown; error?: unknown };

    if (!res.ok || !json.success) {
      const errMsg =
        typeof json.error === 'object' && json.error !== null
          ? ((json.error as { message?: string }).message ?? 'Unknown error')
          : String(json.error ?? 'Request failed');
      throw new Error(`Hub API error (${res.status}): ${errMsg}`);
    }

    return json.data;
  };

  return {
    register: async (machineData) => {
      const data = await request('POST', '/machines', machineData);
      return data as { machineId: string };
    },

    heartbeat: async (machineId, body) => {
      const data = await request('POST', `/machines/${machineId}/heartbeat`, body);
      return data as Awaited<ReturnType<HubClient['heartbeat']>>;
    },

    fireSchedule: async (scheduleId, expectedNextFireAt) => {
      const data = await request('POST', `/schedules/${scheduleId}/fire`, {
        expectedNextFireAt,
      });
      return data as Awaited<ReturnType<HubClient['fireSchedule']>>;
    },

    deregister: async (machineId) => {
      await request('DELETE', `/machines/${machineId}`);
    },

    getMachines: async () => {
      const data = await request('GET', '/machines');
      return data as unknown[];
    },

    getAgents: async (machineId) => {
      const path = machineId ? `/agents?machine=${machineId}` : '/agents';
      const data = await request('GET', path);
      return data as unknown[];
    },

    createRun: async (machineId, agentName, input) => {
      const data = await request('POST', '/runs', { machineId, agentName, input });
      return data;
    },

    cancelRun: async (runId) => {
      await request('POST', `/runs/${runId}/cancel`);
    },

    sendRunInput: async (runId, text) => {
      await request('POST', `/runs/${runId}/input`, { text });
    },

    getRun: async (runId) => {
      const data = await request('GET', `/runs/${runId}`);
      return data;
    },

    getRunEvents: async (runId, after) => {
      const path = after ? `/runs/${runId}/events?after=${after}` : `/runs/${runId}/events`;
      const data = await request('GET', path);
      return data as unknown[];
    },

    getSchedules: async (filters) => {
      const params = new URLSearchParams();
      if (filters?.machineId) params.set('machine', filters.machineId);
      if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled));
      const qs = params.toString();
      const data = await request('GET', `/schedules${qs ? `?${qs}` : ''}`);
      return data as unknown[];
    },

    createSchedule: async (input) => request('POST', '/schedules', input),

    updateSchedule: async (id, patch) => request('PATCH', `/schedules/${id}`, patch),

    deleteSchedule: async (id) => {
      await request('DELETE', `/schedules/${id}`);
    },

    runScheduleNow: async (id) => {
      const data = await request('POST', `/schedules/${id}/run-now`);
      return data as { runId: string };
    },
  };
};
