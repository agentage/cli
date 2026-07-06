import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, type VaultsConfig } from '@agentage/memory-core';
import { createMemoryServer } from '@agentage/server-memory';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../utils/version.js';
import { createLocalMemoryServer } from './local-server.js';

// Two local vaults, never touched on disk: listTools reads only tool metadata and the backends are
// lazy, so no dir is created - but the multi-vault @<vault>/ instructions line is still exercised.
const config: VaultsConfig = {
  version: 1,
  default: 'main',
  vaults: {
    main: { path: join(tmpdir(), 'agentage-contract-main'), mcp: ['local'] },
    work: { path: join(tmpdir(), 'agentage-contract-work'), mcp: ['local'] },
  },
};

interface Contract {
  tools: unknown;
  instructions: string | undefined;
}

// Drive the server over an in-memory transport: initialize + tools/list, then read back the tool
// list and the per-connection instructions (both part of the frozen contract).
const roundtrip = async (server: McpServer): Promise<Contract> => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  const contract: Contract = { tools, instructions: client.getInstructions() };
  await client.close();
  return contract;
};

describe('local MCP contract fidelity', () => {
  it('tools/list + instructions match @agentage/server-memory built directly', async () => {
    const local = await roundtrip(createLocalMemoryServer(await createRegistry(config)));
    // Canonical server built straight from the package (all vaults are local, so same surface).
    // Same builder = trivially equal today; the diff guards a future local reimplementation drift.
    const canonical = await roundtrip(
      createMemoryServer(await createRegistry(config), { scope: 'local', version: VERSION })
    );
    expect(local.tools).toEqual(canonical.tools);
    expect(local.instructions).toEqual(canonical.instructions);
  });

  it('exposes exactly the frozen six memory__* tools', async () => {
    const { tools } = await roundtrip(createLocalMemoryServer(await createRegistry(config)));
    const names = (tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual([
      'memory__delete',
      'memory__edit',
      'memory__list',
      'memory__read',
      'memory__search',
      'memory__write',
    ]);
  });

  it('every tool carries annotations and a non-empty cross-model description', async () => {
    const { tools } = await roundtrip(createLocalMemoryServer(await createRegistry(config)));
    for (const t of tools as Array<{ description?: string; annotations?: object }>) {
      expect(t.description && t.description.length).toBeGreaterThan(40);
      expect(t.annotations).toBeDefined();
    }
  });
});
