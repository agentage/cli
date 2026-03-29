import chalk from 'chalk';
import { isDaemonRunning, startDaemon, restartDaemon } from '../daemon/daemon.js';
import { get } from './daemon-client.js';
import { VERSION } from './version.js';

interface HealthResponse {
  version: string;
}

export const ensureDaemon = async (): Promise<void> => {
  if (!isDaemonRunning()) {
    await startDaemon();
    return;
  }

  // Check if running daemon version matches CLI version
  try {
    const health = await get<HealthResponse>('/api/health');
    if (health.version !== VERSION) {
      console.log(
        chalk.yellow(
          `Daemon version mismatch (daemon: ${health.version}, cli: ${VERSION}) — restarting...`
        )
      );
      await restartDaemon();
    }
  } catch {
    // Health check failed — daemon might be starting up, proceed anyway
  }
};
