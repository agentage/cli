import { type Router, Router as createRouter, json } from 'express';
import { type Agent } from '@agentage/core';
import { loadConfig } from './config.js';
import { cancelRun, getRun, getRuns, sendInput, startRun } from './run-manager.js';
import { getHubSync } from '../hub/hub-sync.js';
import { readAuth } from '../hub/auth.js';
import { createHubClient } from '../hub/hub-client.js';

const VERSION = '0.2.0';
const startTime = Date.now();

let agents: Agent[] = [];
let refreshHandler: (() => Promise<Agent[]>) | null = null;

export const setAgents = (newAgents: Agent[]): void => {
  agents = newAgents;
};

export const getAgents = (): Agent[] => agents;

export const setRefreshHandler = (handler: () => Promise<Agent[]>): void => {
  refreshHandler = handler;
};

export const createRoutes = (): Router => {
  const router = createRouter();
  router.use(json());

  router.get('/api/health', (_req, res) => {
    const config = loadConfig();
    const hubSync = getHubSync();
    const auth = readAuth();

    res.json({
      status: 'ok',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      machineId: config.machine.id,
      hubConnected: hubSync.isConnected(),
      hubUrl: auth?.hub?.url ?? null,
      userEmail: auth?.user?.email ?? null,
    });
  });

  router.get('/api/agents', (_req, res) => {
    res.json(agents.map((a) => a.manifest));
  });

  router.post('/api/agents/refresh', async (_req, res) => {
    try {
      if (refreshHandler) {
        agents = await refreshHandler();
      }
      res.json(agents.map((a) => a.manifest));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/api/agents/:name/run', async (req, res) => {
    try {
      const { name } = req.params;
      const { task, config, context } = req.body as {
        task?: string;
        config?: Record<string, unknown>;
        context?: string[];
      };

      if (!task) {
        res.status(400).json({ error: 'Missing "task" in request body' });
        return;
      }

      const agent = agents.find((a) => a.manifest.name === name);
      if (!agent) {
        res.status(404).json({ error: `Agent "${name}" not found` });
        return;
      }

      const runId = await startRun(agent, task, config, context);
      res.json({ runId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/runs', (_req, res) => {
    res.json(getRuns());
  });

  router.get('/api/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  });

  router.post('/api/runs/:id/cancel', (req, res) => {
    const ok = cancelRun(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'Cannot cancel run' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/api/runs/:id/input', (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text) {
      res.status(400).json({ error: 'Missing "text" in request body' });
      return;
    }

    const ok = sendInput(req.params.id, text);
    if (!ok) {
      res.status(400).json({ error: 'Cannot send input to run' });
      return;
    }
    res.json({ ok: true });
  });

  // Hub proxy routes — daemon proxies CLI requests to hub API
  router.get('/api/hub/machines', async (_req, res) => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const client = createHubClient(auth.hub.url, auth);
      const machines = await client.getMachines();
      res.json(machines);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  router.get('/api/hub/agents', async (req, res) => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const client = createHubClient(auth.hub.url, auth);
      const machineId = req.query.machine as string | undefined;
      const hubAgents = await client.getAgents(machineId);
      res.json(hubAgents);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  router.post('/api/hub/runs', async (req, res) => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const client = createHubClient(auth.hub.url, auth);
      const { machineId, agentName, input } = req.body as {
        machineId: string;
        agentName: string;
        input: string;
      };
      const result = await client.createRun(machineId, agentName, input);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  router.get('/api/hub/runs/:id', async (req, res) => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const client = createHubClient(auth.hub.url, auth);
      const run = await client.getRun(req.params.id);
      res.json(run);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  router.get('/api/hub/runs/:id/events', async (req, res) => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const client = createHubClient(auth.hub.url, auth);
      const after = req.query.after as string | undefined;
      const events = await client.getRunEvents(req.params.id, after);
      res.json(events);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  return router;
};
