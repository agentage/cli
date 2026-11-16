import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { daemonOff, readDaemonFile } from '../../lib/daemon/daemon-file.js';
import { messageOf } from '../../lib/json-output.js';

export interface StatusDaemon {
  pid: number;
  port: number;
  version: string;
}

export interface StatusDaemonDeps {
  off: () => boolean;
  ensure: () => Promise<number>;
  file: typeof readDaemonFile;
}

const defaults: StatusDaemonDeps = {
  off: () => daemonOff(),
  ensure: () => ensureDaemon(),
  file: readDaemonFile,
};

// Two terminals get the same pid: both ask for the one daemon of the folder (started once).
export const daemonOfStatus = async (deps = defaults): Promise<StatusDaemon | null> => {
  if (deps.off()) return null;
  try {
    const port = await deps.ensure();
    const file = deps.file();
    return file && file.port === port ? { pid: file.pid, port, version: file.version } : null;
  } catch (err) {
    console.error(`daemon: ${messageOf(err)}`);
    return null;
  }
};
