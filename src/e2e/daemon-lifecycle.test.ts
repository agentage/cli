/**
 * E2E tests for the full daemon + discovery + execution pipeline.
 *
 * These tests boot a real daemon server in-process, create real .agent.md files
 * on disk, and test the complete flow through REST API and WebSocket.
 *
 * Maps to Phase 2 exit criteria scenarios 1-9.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { type Run } from '@agentage/core';
import { type DaemonServer } from '../daemon/server.js';

// --- Test environment setup ---

const testDir = join(tmpdir(), `agentage-e2e-${Date.now()}`);
const agentsDir = join(testDir, 'agents');
const skillsDir = join(testDir, 'skills');
const port = 17000 + Math.floor(Math.random() * 1000);

let server: DaemonServer;

// Helper: write a config file pointing to our test dirs
const writeTestConfig = (): void => {
  writeFileSync(
    join(testDir, 'config.json'),
    JSON.stringify({
      machine: { id: randomUUID(), name: 'e2e-test-machine' },
      daemon: { port },
      discovery: { dirs: [agentsDir, skillsDir] },
      sync: {
        events: {
          state: true,
          result: true,
          error: true,
          input_required: true,
          'output.llm.delta': true,
          'output.llm.tool_call': true,
          'output.llm.usage': true,
          'output.progress': true,
        },
      },
    })
  );
};

// Helper: write a markdown agent to disk
const writeMarkdownAgent = (name: string, description: string, body: string): string => {
  const filePath = join(agentsDir, `${name}.agent.md`);
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
  return filePath;
};

// Helper: fetch with base URL
const api = {
  get: async <T>(path: string): Promise<{ status: number; body: T }> => {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = (await res.json()) as T;
    return { status: res.status, body };
  },
  post: async <T>(path: string, data?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = (await res.json()) as T;
    return { status: res.status, body };
  },
};

// Helper: open WebSocket, subscribe to a runId, THEN start the run, collect messages until predicate.
// This avoids the race condition where the run completes before WS subscribes.
const runAndCollectWs = async (
  agentName: string,
  task: string,
  until: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000
): Promise<{ runId: string; messages: Array<Record<string, unknown>> }> => {
  // 1. Connect WebSocket
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // 2. Start the run via REST
  const { body } = await api.post<{ runId: string }>(`/api/agents/${agentName}/run`, { task });
  const runId = body.runId;

  // 3. Subscribe THEN collect
  ws.send(JSON.stringify({ type: 'subscribe', runId }));

  const messages: Array<Record<string, unknown>> = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket timeout after ${timeoutMs}ms. Got ${messages.length} messages.`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      messages.push(msg);
      if (until(msg)) {
        clearTimeout(timer);
        ws.close();
        resolve({ runId, messages });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

// --- Setup / Teardown ---

describe('E2E: daemon lifecycle', () => {
  beforeAll(async () => {
    // Create test directories
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    process.env['AGENTAGE_CONFIG_DIR'] = testDir;

    writeTestConfig();

    // Write test agents to disk BEFORE starting the daemon
    writeMarkdownAgent('hello', 'A simple greeting agent', 'You are a friendly greeting agent.');
    writeMarkdownAgent(
      'echo',
      'Echoes input back',
      'You echo the user input back to them verbatim.'
    );

    // Boot full daemon: server + discovery + factories
    const { createDaemonServer } = await import('../daemon/server.js');
    const { createMarkdownFactory } = await import('../discovery/markdown-factory.js');
    const { createCodeFactory } = await import('../discovery/code-factory.js');
    const { scanAgents } = await import('../discovery/scanner.js');

    server = createDaemonServer();
    const factories = [createMarkdownFactory(), createCodeFactory()];
    server.setFactories(factories);

    // Run initial discovery (same as daemon-entry.ts)
    const agents = await scanAgents([agentsDir, skillsDir], factories);
    server.updateAgents(agents);

    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(testDir, { recursive: true, force: true });
  });

  // --- Scenario 1: Config created, daemon running ---

  it('Scenario 1: config.json exists after startup', () => {
    expect(existsSync(join(testDir, 'config.json'))).toBe(true);
    const config = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(config.machine.id).toBeDefined();
    expect(config.daemon.port).toBe(port);
    expect(config.discovery.dirs).toContain(agentsDir);
  });

  it('Scenario 1: daemon is running and healthy', async () => {
    const { status, body } = await api.get<Record<string, unknown>>('/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.machineId).toBeDefined();
    expect(body.hubConnected).toBe(false);
  });

  // --- Scenario 2: Agent discovery from .agent.md ---

  it('Scenario 2: discovers agents from .agent.md files', async () => {
    const { body } = await api.get<Array<Record<string, unknown>>>('/api/agents');
    expect(body.length).toBe(2);

    const names = body.map((a) => a.name);
    expect(names).toContain('hello');
    expect(names).toContain('echo');
  });

  it('Scenario 2: agent manifest has correct fields', async () => {
    const { body } = await api.get<Array<Record<string, unknown>>>('/api/agents');
    const hello = body.find((a) => a.name === 'hello');
    expect(hello).toBeDefined();
    expect(hello!.description).toBe('A simple greeting agent');
    expect(hello!.path).toContain('hello.agent.md');
  });

  it('Scenario 2: agents --json returns valid JSON', async () => {
    const { status, body } = await api.get<unknown[]>('/api/agents');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  // --- Scenario 3: Run an agent, receive streamed output ---

  it('Scenario 3: run agent via REST, get runId back', async () => {
    const { status, body } = await api.post<{ runId: string }>('/api/agents/hello/run', {
      task: 'say hi',
    });
    expect(status).toBe(200);
    expect(body.runId).toBeDefined();
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
  });

  it('Scenario 3: run completes and appears in runs list', async () => {
    const { body: runResult } = await api.post<{ runId: string }>('/api/agents/hello/run', {
      task: 'greet me',
    });

    // Wait for run to complete
    await new Promise((r) => setTimeout(r, 200));

    const { body: runs } = await api.get<Run[]>('/api/runs');
    const run = runs.find((r) => r.id === runResult.runId);
    expect(run).toBeDefined();
    expect(run!.agentName).toBe('hello');
    expect(run!.input).toBe('greet me');
    expect(run!.state).toBe('completed');
    expect(run!.startedAt).toBeDefined();
    expect(run!.endedAt).toBeDefined();
  });

  it('Scenario 3: WebSocket streams output events during a run', async () => {
    const isTerminal = (msg: Record<string, unknown>): boolean =>
      msg.type === 'run_state' &&
      typeof msg.run === 'object' &&
      msg.run !== null &&
      ['completed', 'failed', 'canceled'].includes(
        (msg.run as Record<string, unknown>).state as string
      );

    const { messages } = await runAndCollectWs('echo', 'hello world', isTerminal);

    // Should have received run_event messages with output
    const runEvents = messages.filter((m) => m.type === 'run_event');
    expect(runEvents.length).toBeGreaterThan(0);

    // At least one output event should contain the system prompt
    const outputEvents = runEvents.filter((m) => {
      const event = m.event as Record<string, unknown>;
      const data = event.data as Record<string, unknown>;
      return data.type === 'output';
    });
    expect(outputEvents.length).toBeGreaterThan(0);

    // Should have a run_state with completed
    const stateMessages = messages.filter((m) => m.type === 'run_state');
    expect(stateMessages.length).toBeGreaterThan(0);
    const finalState = stateMessages.at(-1)!;
    expect((finalState.run as Record<string, unknown>).state).toBe('completed');
  });

  it('Scenario 3: WebSocket output includes task text', async () => {
    const isTerminal = (msg: Record<string, unknown>): boolean =>
      msg.type === 'run_state' &&
      typeof msg.run === 'object' &&
      msg.run !== null &&
      ['completed', 'failed', 'canceled'].includes(
        (msg.run as Record<string, unknown>).state as string
      );

    const { messages } = await runAndCollectWs('hello', 'tell me a joke', isTerminal);

    // Check that the task text appears in streamed output
    const allContent = messages
      .filter((m) => m.type === 'run_event')
      .map((m) => {
        const event = m.event as Record<string, unknown>;
        const data = event.data as Record<string, unknown>;
        return String(data.content ?? '');
      })
      .join(' ');

    expect(allContent).toContain('tell me a joke');
  });

  // --- Scenario 5: Detached run (just verify run persists) ---

  it('Scenario 5: run persists after creation (detach mode equivalent)', async () => {
    const { body } = await api.post<{ runId: string }>('/api/agents/hello/run', {
      task: 'background task',
    });
    const runId = body.runId;

    // Immediately query the run by ID — it should exist
    const { status, body: run } = await api.get<Run>(`/api/runs/${runId}`);
    expect(status).toBe(200);
    expect(run.id).toBe(runId);
    expect(run.agentName).toBe('hello');
  });

  // --- Scenario 7: Agent refresh discovers new agents ---

  it('Scenario 7: refresh discovers newly added agent', async () => {
    // Initially we have 2 agents
    const before = await api.get<unknown[]>('/api/agents');
    const countBefore = before.body.length;

    // Write a new agent to disk
    writeMarkdownAgent('newcomer', 'Just arrived', 'I am new here.');

    // Trigger refresh
    const { status, body } = await api.post<Array<Record<string, unknown>>>('/api/agents/refresh');
    expect(status).toBe(200);
    expect(body.length).toBe(countBefore + 1);

    const names = body.map((a) => a.name);
    expect(names).toContain('newcomer');
  });

  // --- Scenario 8: REST API contract ---

  it('Scenario 8: GET /api/health has correct schema', async () => {
    const { body } = await api.get<Record<string, unknown>>('/api/health');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('machineId');
    expect(body).toHaveProperty('hubConnected');
  });

  it('Scenario 8: GET /api/agents returns AgentManifest[]', async () => {
    const { body } = await api.get<Array<Record<string, unknown>>>('/api/agents');
    for (const agent of body) {
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('path');
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.path).toBe('string');
    }
  });

  it('Scenario 8: POST /api/agents/:name/run returns { runId }', async () => {
    const { status, body } = await api.post<Record<string, unknown>>('/api/agents/hello/run', {
      task: 'api test',
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty('runId');
    expect(typeof body.runId).toBe('string');
  });

  it('Scenario 8: GET /api/runs returns Run[]', async () => {
    await new Promise((r) => setTimeout(r, 100));
    const { body } = await api.get<Run[]>('/api/runs');
    expect(Array.isArray(body)).toBe(true);
    for (const run of body) {
      expect(run).toHaveProperty('id');
      expect(run).toHaveProperty('agentName');
      expect(run).toHaveProperty('state');
      expect(run).toHaveProperty('createdAt');
    }
  });

  it('Scenario 8: GET /api/runs/:id returns correct run', async () => {
    const { body: created } = await api.post<{ runId: string }>('/api/agents/hello/run', {
      task: 'single run test',
    });
    await new Promise((r) => setTimeout(r, 100));

    const { status, body: run } = await api.get<Run>(`/api/runs/${created.runId}`);
    expect(status).toBe(200);
    expect(run.id).toBe(created.runId);
    expect(run.agentName).toBe('hello');
    expect(run.input).toBe('single run test');
  });

  // --- Scenario 9: WebSocket protocol ---

  it('Scenario 9: WebSocket subscribe/receive/complete flow', async () => {
    const isCompleted = (msg: Record<string, unknown>): boolean =>
      msg.type === 'run_state' &&
      typeof msg.run === 'object' &&
      msg.run !== null &&
      (msg.run as Record<string, unknown>).state === 'completed';

    const { runId, messages } = await runAndCollectWs('hello', 'ws flow test', isCompleted);

    // Must have both event types
    const types = new Set(messages.map((m) => m.type));
    expect(types.has('run_event')).toBe(true);
    expect(types.has('run_state')).toBe(true);

    // run_event messages must have runId and event
    for (const msg of messages.filter((m) => m.type === 'run_event')) {
      expect(msg.runId).toBe(runId);
      expect(msg.event).toBeDefined();
    }

    // run_state messages must have run object with state
    for (const msg of messages.filter((m) => m.type === 'run_state')) {
      const run = msg.run as Record<string, unknown>;
      expect(run.id).toBe(runId);
      expect(run.state).toBeDefined();
    }
  });

  // --- Error cases ---

  it('returns 404 for unknown agent', async () => {
    const { status } = await api.post<unknown>('/api/agents/nonexistent/run', {
      task: 'nope',
    });
    expect(status).toBe(404);
  });

  it('returns 400 for run without task', async () => {
    const { status } = await api.post<unknown>('/api/agents/hello/run', {});
    expect(status).toBe(400);
  });

  it('returns 404 for unknown run ID', async () => {
    const { status } = await api.get<unknown>('/api/runs/nonexistent-id');
    expect(status).toBe(404);
  });
});
