import { type RequestListener, type Server } from 'node:http';
import { resolve } from 'node:path';
import type * as KitHostModule from '@agentage/extension/host';
import type { HostedExtension, HostOptions } from '@agentage/extension/host';
import { setExit } from '../../lib/exit-code.js';
import { CliError } from '../../lib/json-output.js';
import { loadKitTool } from './kit-tool.js';
import { buildPackage, type PackageBuild } from './package-build.js';
import {
  answerOf,
  dataDirOf,
  listenFrom,
  portOf,
  readRecord,
  removeRecord,
  untilSignal,
  writeRecord,
} from './up-local.js';

// The kit host with its own local-only guard on every route (Host, Origin, Sec-Fetch-Site).
export interface KitHost {
  host: (dir: string, opts: HostOptions) => Promise<HostedExtension>;
}

// The second of the two places that load the kit host as a value.
type KitModule = Pick<typeof KitHostModule, 'hostExtension'>;

export const loadKitHost = async (
  load: () => Promise<KitModule> = () => import('@agentage/extension/host')
): Promise<KitHost> => {
  const kit = await load();
  return { host: (dir, opts) => kit.hostExtension(dir, { ...opts, localOnly: true }) };
};

export interface LocalUpDeps {
  build: (dir: string) => Promise<PackageBuild>;
  kit: () => Promise<KitHost>;
  stopped: () => Promise<string>;
}

export const localUpDeps: LocalUpDeps = {
  build: (dir) => buildPackage(dir),
  kit: () => loadKitHost(),
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

const serve = (hosted: HostedExtension): Promise<Server> =>
  listenFrom(hosted.app as RequestListener);

const close = async (server: Server | null, hosted: HostedExtension, dir: string) => {
  server?.closeAllConnections();
  await Promise.all([server && new Promise((done) => server.close(done)), hosted.stop()]);
  removeRecord(dir);
};

// Ready: the line, and with --json one JSON line on stdout before the envelope at exit.
const ready = (hosted: HostedExtension, url: string, port: number, json: boolean): void => {
  console.log(`up        ${hosted.id} ${hosted.version} on ${url} (Ctrl-C stops it)`);
  const line = { ready: true, id: hosted.id, version: hosted.version, url, port };
  if (json) process.stdout.write(`${JSON.stringify(line)}\n`);
};

const runHosted = async (
  dir: string,
  hosted: HostedExtension,
  deps: LocalUpDeps,
  json: boolean
) => {
  let server: Server | null = null;
  try {
    server = await serve(hosted);
    const port = portOf(server);
    const { instance } = (await hosted.health()).data;
    writeRecord(dir, { pid: process.pid, port, id: hosted.id, instance });
    const url = `http://127.0.0.1:${port}/api/${hosted.id}/`;
    ready(hosted, url, port, json);
    const stoppedBy = await deps.stopped();
    return { id: hosted.id, version: hosted.version, url, port, stoppedBy };
  } finally {
    await close(server, hosted, dir);
  }
};

// D7: the working copy in this terminal, on the next free port from 4244, until Ctrl-C (exit 130).
export const runLocalUp = async (
  folder = '.',
  deps = localUpDeps,
  json = false
): Promise<LocalUp> => {
  const dir = resolve(folder);
  await refuseRunning(dir);
  await warnProblems(await deps.build(dir));
  delete process.env['AGENTAGE_TOKEN'];
  const kit = await deps.kit();
  const hosted = await kit.host(dir, { dataDir: dataDirOf(dir) });
  const done = await runHosted(dir, hosted, deps, json);
  console.log(`stopped   ${done.id} (${done.stoppedBy})`);
  if (done.stoppedBy === 'SIGINT') setExit(130);
  return done;
};
