import { type AuthState } from './auth.js';

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
      agents: Array<{ name: string; description?: string; version?: string; tags?: string[] }>;
      activeRunIds: string[];
    }
  ) => Promise<{ pendingCommands: unknown[] }>;
  deregister: (machineId: string) => Promise<void>;
  getMachines: () => Promise<unknown[]>;
  getAgents: (machineId?: string) => Promise<unknown[]>;
  createRun: (machineId: string, agentName: string, input: string) => Promise<unknown>;
  cancelRun: (runId: string) => Promise<void>;
  sendRunInput: (runId: string, text: string) => Promise<void>;
  getRun: (runId: string) => Promise<unknown>;
  getRunEvents: (runId: string, after?: string) => Promise<unknown[]>;
}

export const createHubClient = (hubUrl: string, auth: AuthState): HubClient => {
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.session.access_token}`,
  });

  const apiUrl = `${hubUrl}/api`;

  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

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
      return data as { pendingCommands: unknown[] };
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
  };
};
