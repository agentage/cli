import { type Command } from 'commander';
import { ensureDaemon, health, type Health } from '../../lib/daemon/daemon-client.js';
import { isAlive, readDaemonFile } from '../../lib/daemon/daemon-file.js';
import { stopDaemon } from '../../lib/daemon/daemon-stop.js';
import { addJson } from '../../lib/json-output.js';
import { helpOrUnknown } from '../extension/list.js';

export interface DaemonOptions {
  json?: boolean;
}

export type DaemonStatus =
  { running: false } | ({ running: true; pid: number; port: number } & Health);

export const runDaemonStatus = async (): Promise<DaemonStatus> => {
  const file = readDaemonFile();
  const live = file && isAlive(file.pid) ? await health(file.port) : null;
  if (!file || !live) {
    console.log('daemon: not running');
    return { running: false };
  }
  console.log(`daemon: ${live.status} on 127.0.0.1:${file.port}, pid ${file.pid}, ${live.version}`);
  for (const ext of live.extensions) console.log(`  ${ext.id} ${ext.version} ${ext.state}`);
  return { running: true, pid: file.pid, port: file.port, ...live };
};

export const runDaemonStop = async (): Promise<{ stopped: boolean }> => {
  const pid = await stopDaemon();
  console.log(pid === null ? 'daemon: not running' : `daemon: stopped (pid ${pid})`);
  return { stopped: pid !== null };
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
