import { resolve } from 'node:path';
import type { HostedExtension, HostOptions } from '@agentage/extension/host';
import { CliError } from '../../lib/json-output.js';
import { buildPackage, type PackageBuild } from './package-build.js';
import { loadKitTool } from './kit-tool.js';
import {
  answerOf,
  dataDirOf,
  listen,
  nextFreePort,
  readRecord,
  removeRecord,
  untilSignal,
  writeRecord,
} from './up-local.js';

export type Host = (dir: string, opts: HostOptions) => Promise<HostedExtension>;

export interface LocalUpDeps {
  build: (dir: string) => Promise<PackageBuild>;
  host: Host;
  stopped: () => Promise<string>;
}

// The kit host, loaded on use: the second of the two places that load it as a value.
const kitHost: Host = async (dir, opts) =>
  (await import('@agentage/extension/host')).hostExtension(dir, opts);

export const localUpDeps: LocalUpDeps = {
  build: (dir) => buildPackage(dir),
  host: kitHost,
  stopped: untilSignal,
};

export interface LocalUp {
  id: string;
  version: string;
  url: string;
  port: number;
  stoppedBy: string;
}

const refuseRunning = async (dir: string): Promise<void> => {
  const record = readRecord(dir);
  if (!record) return;
  if ((await answerOf(record)) !== 'ours') return removeRecord(dir);
  const at = `http://127.0.0.1:${record.port}`;
  throw new CliError('already_running', `extension up runs for ${dir} on ${at}: extension down`);
};

// Problems do not stop a local run; they are printed, as `extension build` would refuse them.
const warnProblems = async ({ report }: PackageBuild): Promise<void> => {
  if (report.conforms) return;
  for (const text of (await loadKitTool()).checkLines(report)) console.error(`check     ${text}`);
};

// D7: the working copy in this terminal, on the next free port from 4244, until Ctrl-C.
export const runLocalUp = async (folder = '.', deps = localUpDeps): Promise<LocalUp> => {
  const dir = resolve(folder);
  await refuseRunning(dir);
  await warnProblems(await deps.build(dir));
  delete process.env['AGENTAGE_TOKEN'];
  const hosted = await deps.host(dir, { dataDir: dataDirOf(dir) });
  const port = await nextFreePort();
  const server = await listen(hosted.app, port);
  const { instance } = (await hosted.health()).data;
  writeRecord(dir, { pid: process.pid, port, id: hosted.id, instance });
  const url = `http://127.0.0.1:${port}/api/${hosted.id}/`;
  console.log(`up        ${hosted.id} ${hosted.version} on ${url} (Ctrl-C stops it)`);
  const stoppedBy = await deps.stopped();
  server.closeAllConnections();
  await Promise.all([new Promise((done) => server.close(done)), hosted.stop()]);
  removeRecord(dir);
  console.log(`stopped   ${hosted.id} (${stoppedBy})`);
  return { id: hosted.id, version: hosted.version, url, port, stoppedBy };
};
