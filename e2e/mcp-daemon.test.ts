import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, freePort, type CliMachine } from './helpers.js';

// M3 daemon MCP tier: the daemon exposes the frozen 6 memory__* tools at POST /mcp (stateless
// Streamable HTTP). An ephemeral port + isolated AGENTAGE_CONFIG_DIR keep it off the real daemon /
// :4243; stop only signals the pid this test started. Asserts the surface over one vault: 6 tools,
// plain-path routing, and dual-channel output (text AND structuredContent). @<vault>/ routing and
// the frozen contract behaviors live in mcp-contract.test.ts. @p0

const pidOf = (m: CliMachine): number | null => {
  const p = join(m.configDir, 'daemon.pid');
  return existsSync(p) ? Number.parseInt(readFileSync(p, 'utf-8').trim(), 10) : null;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface RpcResult {
  serverInfo?: { name: string };
  instructions?: string;
  tools?: Array<{ name: string }>;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

// A stateless MCP call: plain fetch with the required Accept header (application/json +
// text/event-stream); enableJsonResponse means a single JSON-RPC object comes back.
const mcpRpc = async (port: number, method: string, params: unknown): Promise<RpcResult> => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(res.ok, `POST /mcp ${method} -> ${res.status}`).toBe(true);
  const body = (await res.json()) as { result?: RpcResult; error?: { message: string } };
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result ?? {};
};

const callTool = (port: number, name: string, args: Record<string, unknown>): Promise<RpcResult> =>
  mcpRpc(port, 'tools/call', { name, arguments: args });

test.describe('daemon /mcp exposes the frozen tools @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('initialize + tools/list + all six tools over :port/mcp', async () => {
    const port = await freePort();
    const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
    let daemonPid: number | null = null;
    try {
      const add = await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      expect(add.code, add.stderr).toBe(0);

      const start = await m.exec(['daemon', 'start']);
      expect(start.code, start.stderr).toBe(0);
      daemonPid = pidOf(m);
      expect(daemonPid, 'daemon.pid written').not.toBeNull();

      const init = await mcpRpc(port, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0' },
      });
      expect(init.serverInfo?.name).toBe('agentage-memory');
      expect((init.instructions ?? '').length).toBeGreaterThan(0);

      const list = await mcpRpc(port, 'tools/list', {});
      expect((list.tools ?? []).map((t) => t.name).sort()).toEqual([
        'memory__delete',
        'memory__edit',
        'memory__list',
        'memory__read',
        'memory__search',
        'memory__write',
      ]);

      // write -> dual channel: rendered markdown in content[0].text AND a typed structuredContent.
      const write = await callTool(port, 'memory__write', {
        path: 'notes/e.md',
        body: 'daemon mcp quokka',
      });
      expect(write.content?.[0]?.type).toBe('text');
      expect(write.content?.[0]?.text).toContain('notes/e.md');
      expect(write.structuredContent?.path).toBe('notes/e.md');
      expect(typeof write.structuredContent?.updated).toBe('string');

      const search = await callTool(port, 'memory__search', { query: 'quokka' });
      const results = search.structuredContent?.results as Array<{ path: string }>;
      expect(results.map((r) => r.path)).toEqual(['notes/e.md']);
      expect(search.content?.[0]?.text).toContain('quokka');

      const read = await callTool(port, 'memory__read', { path: 'notes/e.md' });
      expect(read.structuredContent?.body).toContain('daemon mcp quokka');
      expect(read.content?.[0]?.text).toContain('daemon mcp quokka');

      const listTool = await callTool(port, 'memory__list', {});
      expect(Array.isArray(listTool.structuredContent?.entries)).toBe(true);

      const edit = await callTool(port, 'memory__edit', {
        path: 'notes/e.md',
        mode: 'append',
        body: 'more',
      });
      expect(edit.structuredContent?.path).toBe('notes/e.md');

      const del = await callTool(port, 'memory__delete', { path: 'notes/e.md' });
      expect(del.structuredContent?.deleted).toBe(true);

      const stop = await m.exec(['daemon', 'stop']);
      expect(stop.code, stop.stderr).toBe(0);
    } finally {
      try {
        // the daemon may exit between the alive() check and the kill (ESRCH race)
        if (daemonPid !== null && alive(daemonPid)) process.kill(daemonPid, 'SIGKILL');
      } catch {
        // already gone - the SIGKILL is only a leak guard
      }
      m.cleanup();
    }
  });
});
