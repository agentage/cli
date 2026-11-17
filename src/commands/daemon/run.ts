import { CommanderError } from 'commander';
import type { Installer } from '@agentage/extension/host';
import { daemonPort, EADDRINUSE_EXIT } from '../../lib/daemon/daemon-file.js';
import { getConfigDir } from '../../lib/fs/config.js';
import { CliError } from '../../lib/json-output.js';
import { VERSION } from '../../utils/version.js';
import { KIT_EXIT } from '../extension/kit-commands.js';

export interface DaemonRunDeps {
  installer: () => Installer;
  // Runs once before the daemon listens: the one-time move of the old lists.
  before?: () => Promise<void>;
}

// C5: the test clock comes only from this env (the e2e lab); unset or empty is the real clock.
export const clockRateOf = (env: NodeJS.ProcessEnv = process.env): { clockRate?: number } => {
  const raw = env['AGENTAGE_DAEMON_CLOCK_RATE'];
  return raw ? { clockRate: Number(raw) } : {};
};

const STARTERS = ['cli', 'desktop'];

// C5: the desktop sets AGENTAGE_STARTED_BY=desktop; unset or another value is the cli.
export const startedByOf = (env: NodeJS.ProcessEnv = process.env): string => {
  const raw = env['AGENTAGE_STARTED_BY'] ?? '';
  return STARTERS.includes(raw) ? raw : 'cli';
};

const signalled = (): Promise<void> =>
  new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });

// The kit's refusal of a second daemon on one config folder (from the move or from createDaemon).
const running = (err: unknown): never => {
  const { code, details } = err as { code?: unknown; details?: { pid?: number; port?: number } };
  if (code !== 'DAEMON_RUNNING') throw err;
  const at = `pid ${details?.pid ?? '?'} on 127.0.0.1:${details?.port ?? '?'}`;
  throw new CliError('already_running', `a daemon (${at}) runs on ${getConfigDir()} already`);
};

// A busy port exits EADDRINUSE_EXIT, so the cli that spawned this process stops waiting.
const busy = (err: unknown): never => {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') return running(err);
  console.error(`port ${daemonPort()} is in use`);
  throw new CommanderError(EADDRINUSE_EXIT, KIT_EXIT, 'port in use');
};

// The daemon process (hidden `daemon run`): the kit's daemon until SIGTERM, then every child stops.
export const runDaemon = async (deps: DaemonRunDeps): Promise<void> => {
  // Attached first: a stop during the move or the boot is kept and served once the boot ends.
  const stopping = signalled();
  await deps.before?.().catch(running);
  const { createDaemon } = await import('@agentage/extension/host');
  const opts = {
    configDir: getConfigDir(),
    port: daemonPort(),
    version: VERSION,
    ...clockRateOf(),
  };
  const daemon = await createDaemon({
    ...opts,
    install: deps.installer(),
    startedBy: startedByOf(),
  }).catch(busy);
  await stopping;
  await daemon.stop();
};
