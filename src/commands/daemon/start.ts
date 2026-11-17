import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { readDaemonFile, type DaemonFile } from '../../lib/daemon/daemon-file.js';
import { CliError } from '../../lib/json-output.js';

// C5 for a client such as the desktop: where the daemon answers; the host token stays in the file.
export interface DaemonStart {
  pid: number;
  url: string;
  protocol: number;
  startedBy: string;
}

// Connect-or-start: the running daemon of this config folder, else a new one.
export const runDaemonStart = async (
  ensure: () => Promise<number> = () => ensureDaemon(),
  read: () => DaemonFile | null = readDaemonFile
): Promise<DaemonStart> => {
  const port = await ensure();
  const file = read();
  if (!file || file.port !== port)
    throw new CliError(
      'daemon_unavailable',
      `no daemon.json names the daemon on 127.0.0.1:${port}`
    );
  const { pid, protocol, startedBy } = file;
  const url = `http://127.0.0.1:${port}`;
  console.log(`daemon: running on 127.0.0.1:${port}, pid ${pid}, started by ${startedBy}`);
  return { pid, url, protocol, startedBy };
};
