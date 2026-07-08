import { createRegistry, type VaultHandle, type VaultRegistry } from '@agentage/memory-core';
import { createMemoryServer } from '@agentage/server-memory';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadVaultsConfig } from '../lib/vault/vaults.js';
import { VERSION } from '../utils/version.js';

// Restrict a registry to its offline (git working-copy) vaults, so the local MCP surface exposes
// exactly what the DirectClient does - never a network-backed vault over the no-auth loopback.
const localOnly = (registry: VaultRegistry): VaultRegistry => {
  const local = registry.list().filter((h) => h.backend.capabilities().kind === 'local');
  const byId = new Map<string, VaultHandle>(local.map((h) => [h.id, h]));
  const def = registry.default();
  const defaultHandle = def && byId.has(def.id) ? def : undefined;
  return {
    list: () => local,
    get: (id) => byId.get(id),
    default: () => defaultHandle,
    surfaced: () => local,
    watch: () => () => {},
    close: async () => {},
  };
};

// Build the frozen 6-tool MCP server over one registry, reusing @agentage/server-memory's contract
// layer verbatim (descriptions, schemas, annotations, per-connection instructions) - zero drift.
export const createLocalMemoryServer = (registry: VaultRegistry): McpServer =>
  createMemoryServer(localOnly(registry), { scope: 'local', version: VERSION });

// The whole local stack: read this machine's vaults.json (the same config the daemon + CLI verbs
// load) -> registry -> an MCP server over the surfaced local vaults.
export const loadLocalMemoryServer = async (): Promise<McpServer> =>
  createLocalMemoryServer(await createRegistry(loadVaultsConfig().config));
