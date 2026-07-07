import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const jsonRpcError = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

// Stateless Streamable HTTP (JSON, no session), mirroring the cloud memory endpoint: a fresh MCP
// server + transport per POST, torn down when the response closes. GET/DELETE are 405 - stateless
// exposes no server-initiated SSE stream or session teardown. Tokenless (editor clients stay
// simple) but DNS-rebinding-protected: allowedHosts pins the Host to the bound loopback port.
export const handleMcp = async (
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: () => Promise<McpServer>,
  allowedHosts: string[]
): Promise<void> => {
  if (req.method !== 'POST') {
    jsonRpcError(res, 405, 'Method not allowed: this endpoint is stateless (POST only).');
    return;
  }
  const server = await buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
  }
};
