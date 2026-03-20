import { type Router, Router as createRouter, json } from 'express';
import { type Agent } from '@agentage/core';
import { loadConfig } from './config.js';
import { cancelRun, getRun, getRuns, sendInput, startRun } from './run-manager.js';

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
    res.json({
      status: 'ok',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      machineId: config.machine.id,
      hubConnected: false,
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

  // OAuth callback placeholder
  router.get('/auth/callback', (_req, res) => {
    res.send('Hub sync not yet available.');
  });

  return router;
};
