import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, CLI_BIN, createCliMachine } from './helpers.js';

// M3 stdio MCP tier: `agentage mcp` serves the frozen 6 tools over stdio to a client that spawns
// the process (Cursor, Windsurf, Zed). Own process, isolated AGENTAGE_CONFIG_DIR; clean shutdown on
// stdin EOF. @p0

interface RpcResult {
  serverInfo?: { name: string };
  instructions?: string;
  tools?: Array<{ name: string }>;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

interface StdioMcp {
  request: (method: string, params: unknown) => Promise<RpcResult>;
  notify: (method: string, params: unknown) => void;
  close: () => Promise<number>;
}

// Drive `agentage mcp` over newline-delimited JSON-RPC on stdio: match responses by id.
const startStdioMcp = (configDir: string): StdioMcp => {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENTAGE_CONFIG_DIR: configDir, NO_COLOR: '1' };
  const child = spawn(process.execPath, [CLI_BIN, 'mcp'], { env });
  child.stderr.on('data', () => {});
  const pending = new Map<number, (r: RpcResult) => void>();
  let buf = '';
  let nextId = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { id?: number; result?: RpcResult };
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        pending.get(msg.id)?.(msg.result ?? {});
        pending.delete(msg.id);
      }
    }
  });
  const send = (payload: object): void => void child.stdin.write(`${JSON.stringify(payload)}\n`);
  return {
    request: (method, params) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        send({ jsonrpc: '2.0', id, method, params });
      }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    close: () =>
      new Promise((resolve) => {
        const t = setTimeout(() => child.kill('SIGTERM'), 3000);
        child.on('close', (code) => {
          clearTimeout(t);
          resolve(code ?? 0);
        });
        child.stdin.end();
      }),
  };
};

test.describe('agentage mcp over stdio @p0 @offline', () => {
  test.beforeAll(() => assertCliBuilt());

  test('initialize + tools/list + a tool call, clean EOF shutdown', async () => {
    const m = createCliMachine();
    try {
      const add = await m.exec(['vault', 'add', 'main', '--local', join(m.configDir, 'main')]);
      expect(add.code, add.stderr).toBe(0);

      const mcp = startStdioMcp(m.configDir);

      const init = await mcp.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0' },
      });
      expect(init.serverInfo?.name).toBe('agentage-memory');
      expect((init.instructions ?? '').length).toBeGreaterThan(0);
      mcp.notify('notifications/initialized', {});

      const list = await mcp.request('tools/list', {});
      expect((list.tools ?? []).map((t) => t.name).sort()).toEqual([
        'memory__delete',
        'memory__edit',
        'memory__list',
        'memory__read',
        'memory__search',
        'memory__write',
      ]);

      const write = await mcp.request('tools/call', {
        name: 'memory__write',
        arguments: { path: 'stdio.md', body: 'stdio wombat' },
      });
      expect(write.content?.[0]?.type).toBe('text');
      expect(write.content?.[0]?.text).toContain('stdio.md');
      expect(write.structuredContent?.path).toBe('stdio.md');

      const read = await mcp.request('tools/call', {
        name: 'memory__read',
        arguments: { path: 'stdio.md' },
      });
      expect(read.structuredContent?.body).toContain('stdio wombat');

      const code = await mcp.close();
      expect(code, 'clean exit on stdin EOF').toBe(0);
    } finally {
      m.cleanup();
    }
  });
});
