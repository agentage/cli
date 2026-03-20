import { createServer, type Server } from 'node:http';
import express from 'express';
import { type Agent } from '@agentage/core';
import { loadConfig } from './config.js';
import { logInfo } from './logger.js';
import { createRoutes, setAgents } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { cancelAllRuns } from './run-manager.js';

export interface DaemonServer {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  updateAgents: (agents: Agent[]) => void;
}

export const createDaemonServer = (): DaemonServer => {
  const app = express();
  const server = createServer(app);

  const routes = createRoutes();
  app.use(routes);

  setupWebSocket(server);

  const start = async (): Promise<void> => {
    const config = loadConfig();
    const port = config.daemon.port;

    return new Promise((resolve, reject) => {
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} already in use. Is another daemon running?`));
        } else {
          reject(err);
        }
      });

      server.listen(port, () => {
        logInfo(`Daemon server listening on port ${port}`);
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

  return { server, start, stop, updateAgents };
};
