import { createServer, type Server } from 'node:http';
import express from 'express';
import { type Agent, type AgentFactory } from '@agentage/core';
import { loadConfig, getAgentsDirs, getBindHost } from './config.js';
import { logInfo } from './logger.js';
import { createRoutes, setAgents, setRefreshHandler } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { cancelAllRuns } from './run-manager.js';
import { scanAgents } from '../discovery/scanner.js';

export interface DaemonServer {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  updateAgents: (agents: Agent[]) => void;
  setFactories: (factories: AgentFactory[]) => void;
}

export const createDaemonServer = (): DaemonServer => {
  const app = express();
  const server = createServer(app);
  let factories: AgentFactory[] = [];

  const routes = createRoutes();
  app.use(routes);

  setupWebSocket(server);

  // Wire up refresh to actually rescan
  setRefreshHandler(async () => {
    const config = loadConfig();
    const agents = await scanAgents(getAgentsDirs(config), factories);
    setAgents(agents);
    logInfo(`Refresh: discovered ${agents.length} agent(s)`);
    return agents;
  });

  const start = async (): Promise<void> => {
    const config = loadConfig();
    const port = config.daemon.port;
    const host = getBindHost(config);

    return new Promise((resolve, reject) => {
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} already in use. Is another daemon running?`));
        } else {
          reject(err);
        }
      });

      server.listen(port, host, () => {
        logInfo(`Daemon server listening on ${host}:${port}`);
        resolve();
      });
    });
  };

  const stop = async (): Promise<void> => {
    cancelAllRuns();
    return new Promise((resolve) => {
      server.close(() => {
        logInfo('Daemon server stopped');
        resolve();
      });
    });
  };

  const updateAgents = (agents: Agent[]): void => {
    setAgents(agents);
  };

  const setFactoriesFn = (f: AgentFactory[]): void => {
    factories = f;
  };

  return { server, start, stop, updateAgents, setFactories: setFactoriesFn };
};
