import { isDaemonRunning, startDaemon } from '../daemon/daemon.js';

export const ensureDaemon = async (): Promise<void> => {
  if (isDaemonRunning()) return;
  await startDaemon();
};
