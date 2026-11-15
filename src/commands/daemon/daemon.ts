import { type Command } from 'commander';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { isAlive, readDaemonFile, type DaemonFile } from '../../lib/daemon/daemon-file.js';
import { probeRetry, proven, type Health } from '../../lib/daemon/daemon-probe.js';
import { degradedReasons, healthLines, type HealthMarks } from '../../lib/daemon/daemon-health.js';
import { stopDaemon, type StopResult } from '../../lib/daemon/daemon-stop.js';
import { addJson } from '../../lib/json-output.js';
import { readMoveReport, type MoveReport } from './move.js';
import { helpOrUnknown } from '../extension/list.js';

export interface DaemonOptions {
  json?: boolean;
}

export type DaemonStatus = (
  | { running: false }
  | { running: false; unresponsive: true; pid: number; port: number }
  | ({ running: true; port: number; reasons?: string[] } & Health & HealthMarks)
) & { move?: MoveReport | null };

// Degraded always comes with its reasons, in the lines and in --json.
const report = (file: DaemonFile, live: Health & HealthMarks): DaemonStatus => {
  console.log(`daemon: ${live.status} on 127.0.0.1:${file.port}, pid ${live.pid}, ${live.version}`);
  const reasons = degradedReasons(live);
  for (const line of healthLines(live, reasons)) console.log(line);
  return { running: true, port: file.port, ...live, ...(reasons.length > 0 && { reasons }) };
};

// Reads only: a stale daemon.json is left for the next start or stop to remove.
// The D6 move's warning or skipped entries, until the user fixes them.
const moveLines = (): { move: MoveReport | null } => {
  const move = readMoveReport();
  if (move?.warning) console.log(`move: ${move.warning}`);
  for (const { entry, reason } of move?.skipped ?? [])
    console.log(`move skipped ${entry}: ${reason}`);
  return { move };
};

export const runDaemonStatus = async (look = probeRetry): Promise<DaemonStatus> => {
  const status = await daemonStatus(look);
  return { ...status, ...moveLines() };
};

const daemonStatus = async (look: typeof probeRetry): Promise<DaemonStatus> => {
  const file = readDaemonFile();
  const found = file && isAlive(file.pid) ? await look(file.port) : null;
  if (file && found?.kind === 'silent') {
    console.log(`daemon: pid ${file.pid} does not answer on 127.0.0.1:${file.port}`);
    return { running: false, unresponsive: true, pid: file.pid, port: file.port };
  }
  const live = file && found ? proven(file, found) : null;
  if (!file || !live) return (console.log('daemon: not running'), { running: false });
  return report(file, live);
};

const STOPPED = (result: StopResult): string => {
  if (result === null) return 'daemon: not running';
  if ('stale' in result)
    return `daemon: not running (daemon.json was stale; pid ${result.stale} not signalled)`;
  return `daemon: stopped (pid ${result.stopped})`;
};

export const runDaemonStop = async (stop = () => stopDaemon()): Promise<{ stopped: boolean }> => {
  const result = await stop();
  console.log(STOPPED(result));
  return { stopped: result !== null && 'stopped' in result };
};

export const runDaemonRestart = async (
  ensure = () => ensureDaemon()
): Promise<{ port: number }> => {
  await stopDaemon();
  return { port: await ensure() };
};

type Action = (opts: DaemonOptions) => Promise<void>;

export interface DaemonActions {
  status: Action;
  stop: Action;
  restart: Action;
  run: Action;
}

const HELP = `
The daemon runs the installed extensions on 127.0.0.1 (port 4243, AGENTAGE_DAEMON_PORT for
another), one child process each, and serves /api/{id}/* and /host/extensions. setup starts it,
and so does each command that needs it. daemon.json in the config folder names its pid and port.`;

export const registerDaemon = (program: Command, actions: DaemonActions): void => {
  const group = program
    .command('daemon')
    .description('Show, stop or restart the local daemon that runs extensions')
    .allowExcessArguments()
    .addHelpText('after', HELP)
    .action(helpOrUnknown);
  addJson(group.command('status').description('Show the daemon and its extensions')).action(
    actions.status
  );
  addJson(group.command('stop').description('Stop the daemon and every extension')).action(
    actions.stop
  );
  addJson(group.command('restart').description('Stop the daemon, then start it')).action(
    actions.restart
  );
  group.command('run', { hidden: true }).description('Run the daemon here').action(actions.run);
};
