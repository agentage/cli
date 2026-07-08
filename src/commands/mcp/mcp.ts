import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Command } from 'commander';
import { loadLocalMemoryServer } from '../../mcp/local-server.js';

// `agentage mcp`: serve the frozen 6 memory tools over stdio to a client that spawns this process
// (Cursor, Windsurf, Zed). In-process engine - its own process - so stdout is the JSON-RPC wire and
// nothing else may print there. The transport keeps the process alive until stdin EOF.
const mcpAction = async (): Promise<void> => {
  const server = await loadLocalMemoryServer();
  await server.connect(new StdioServerTransport());
};

export const registerMcp = (program: Command): void => {
  program
    .command('mcp')
    .description('Serve the local memory to on-machine AI clients as an MCP server over stdio')
    .action(() => mcpAction());
};
