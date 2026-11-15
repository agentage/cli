import { CommanderError } from 'commander';
import type { Installer } from '@agentage/extension/host';
import { daemonPort, EADDRINUSE_EXIT } from '../../lib/daemon/daemon-file.js';
import { getConfigDir } from '../../lib/fs/config.js';
import { VERSION } from '../../utils/version.js';
import { KIT_EXIT } from '../extension/kit-commands.js';

export interface DaemonRunDeps {
  installer: () => Installer;
  // Runs once before the daemon listens: the one-time move of the old lists.
  before?: () => Promise<void>;
}

const signalled = (): Promise<void> =>
  new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });

// A busy port exits EADDRINUSE_EXIT, so the cli that spawned this process stops waiting.
const busy = (err: unknown): never => {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  console.error(`port ${daemonPort()} is in use`);
  throw new CommanderError(EADDRINUSE_EXIT, KIT_EXIT, 'port in use');
};

// The daemon process (hidden `daemon run`): the kit's daemon until SIGTERM, then every child stops.
export const runDaemon = async (deps: DaemonRunDeps): Promise<void> => {
  // Attached first: a stop during the move or the boot is kept and served once the boot ends.
  const stopping = signalled();
  await deps.before?.();
  const { createDaemon } = await import('@agentage/extension/host');
  const opts = { configDir: getConfigDir(), port: daemonPort(), version: VERSION };
  const daemon = await createDaemon({ ...opts, install: deps.installer(), startedBy: 'cli' }).catch(
    busy
  );
  await stopping;
  await daemon.stop();
};
