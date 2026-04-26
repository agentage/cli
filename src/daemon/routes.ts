import { type Router, Router as createRouter, json, type Request, type Response } from 'express';
import { type Agent, type ActionRegistry, type JsonSchema } from '@agentage/core';
import { loadConfig } from './config.js';
import { collectMachineMetrics } from './metrics.js';
import { cancelRun, getRun, getRuns, sendInput, startRun } from './run-manager.js';
import { getHubSync } from '../hub/hub-sync.js';
import { readAuth } from '../hub/auth.js';
import { createHubClient } from '../hub/hub-client.js';
import { getLastScanWarnings } from '../discovery/scanner.js';
import { getActionRegistry } from './actions.js';

import { VERSION } from '../utils/version.js';
import { loadProjects } from '../projects/projects.js';

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

/**
 * `task` is required iff the agent's inputSchema explicitly lists it under
 * `required`. Agents are expected to declare their inputSchema; there is no
 * legacy fallback.
 */
const isTaskRequired = (schema: JsonSchema | undefined): boolean => {
  const required = (schema as { required?: unknown } | undefined)?.required;
  return Array.isArray(required) && required.includes('task');
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
      hubConnecting: hubSync.isConnecting(),
      authExpired: hubSync.isAuthExpired(),
      hubUrl: auth?.hub?.url ?? null,
      userEmail: auth?.user?.email ?? null,
    });
  });

  router.get('/api/metrics', async (_req, res) => {
    try {
      const metrics = await collectMachineMetrics();
      res.json(metrics);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/agents', (_req, res) => {
    res.json(agents.map((a) => a.manifest));
  });

  router.get('/api/agents/warnings', (_req, res) => {
    res.json(getLastScanWarnings());
  });

  router.get('/api/agents/:name', (req, res) => {
    const agent = agents.find((a) => a.manifest.name === req.params.name);
    if (!agent) {
      res.status(404).json({ error: `Agent "${req.params.name}" not found` });
      return;
    }
    res.json(agent.manifest);
  });

  router.post('/api/agents/refresh', async (_req, res) => {
    try {
      if (refreshHandler) {
        agents = await refreshHandler();
      }
      // Trigger heartbeat to sync agents to hub immediately
      const { getHubSync } = await import('../hub/hub-sync.js');
      getHubSync()
        .triggerHeartbeat()
        .catch(() => {});
      res.json(agents.map((a) => a.manifest));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/api/heartbeat', async (_req, res) => {
    try {
      const { getHubSync } = await import('../hub/hub-sync.js');
      await getHubSync().triggerHeartbeat();
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/projects', (_req, res) => {
    const projects = loadProjects();
    res.json(projects);
  });

  router.post('/api/agents/:name/run', async (req, res) => {
    try {
      const { name } = req.params;
      const { task, config, context, project } = req.body as {
        task?: string;
        config?: Record<string, unknown>;
        context?: string[];
        project?: { name: string; path: string; branch?: string; remote?: string };
      };

      const agent = agents.find((a) => a.manifest.name === name);
      if (!agent) {
        res.status(404).json({ error: `Agent "${name}" not found` });
        return;
      }

      if (!task && isTaskRequired(agent.manifest.inputSchema)) {
        res.status(400).json({ error: 'Missing "task" in request body' });
        return;
      }

      const runId = await startRun(agent, task ?? '', config, context, project);
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

  // Schedule proxy routes — CLI subcommands hit these, daemon forwards to hub
  const withHubClient = async (
    res: Parameters<Parameters<typeof router.get>[1]>[1],
    fn: (client: ReturnType<typeof createHubClient>) => Promise<unknown>
  ): Promise<void> => {
    const auth = readAuth();
    if (!auth) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    try {
      const result = await fn(createHubClient(auth.hub.url, auth));
      res.json(result ?? { ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  };

  router.get('/api/hub/schedules', async (req, res) => {
    await withHubClient(res, (client) =>
      client.getSchedules({
        machineId: req.query.machine as string | undefined,
        enabled: req.query.enabled === undefined ? undefined : req.query.enabled === 'true',
      })
    );
  });

  router.post('/api/hub/schedules', async (req, res) => {
    await withHubClient(res, (client) =>
      client.createSchedule(req.body as Parameters<typeof client.createSchedule>[0])
    );
  });

  router.patch('/api/hub/schedules/:id', async (req, res) => {
    await withHubClient(res, (client) =>
      client.updateSchedule(req.params.id, req.body as Record<string, unknown>)
    );
  });

  router.delete('/api/hub/schedules/:id', async (req, res) => {
    await withHubClient(res, async (client) => {
      await client.deleteSchedule(req.params.id);
      return { ok: true };
    });
  });

  router.post('/api/hub/schedules/:id/run-now', async (req, res) => {
    await withHubClient(res, (client) => client.runScheduleNow(req.params.id));
  });

  wireActionRoutes(router, getActionRegistry());

  return router;
};

const parseCapabilities = (req: Request): string[] => {
  const header = req.header('x-capabilities');
  if (!header) return ['*'];
  return header
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
};

const streamInvocation = async (
  registry: ActionRegistry,
  actionName: string,
  body: Record<string, unknown>,
  req: Request,
  res: Response
): Promise<void> => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const ac = new AbortController();
  let invocationComplete = false;
  // Detect client disconnect on the socket rather than req 'close', which can
  // fire as soon as the request body is fully consumed — not only on real aborts.
  res.on('close', () => {
    if (!invocationComplete) ac.abort();
  });

  const gen = registry.invoke(
    {
      action: actionName,
      version: typeof body.version === 'string' ? body.version : undefined,
      input: body.input,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      callerId: req.header('x-caller-id') ?? 'local',
      capabilities: parseCapabilities(req),
    },
    ac.signal
  );

  for await (const event of gen) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'result' || event.type === 'error') {
      invocationComplete = true;
    }
  }
  invocationComplete = true;
  res.end();
};

export const wireActionRoutes = (router: Router, registry: ActionRegistry): void => {
  router.get('/api/actions', (_req, res) => {
    res.json({ success: true, data: registry.list() });
  });

  router.post('/api/actions/:name', async (req, res) => {
    await streamInvocation(
      registry,
      req.params.name,
      (req.body ?? {}) as Record<string, unknown>,
      req,
      res
    );
  });
};
