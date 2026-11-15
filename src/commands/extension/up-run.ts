import {
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import type * as KitHostModule from '@agentage/extension/host';
import type { HostedExtension, HostOptions } from '@agentage/extension/host';
import { setExit } from '../../lib/exit-code.js';
import { CliError } from '../../lib/json-output.js';
import { loadKitTool } from './kit-tool.js';
import { buildPackage, type PackageBuild } from './package-build.js';
import { loopbackOnly } from './up-guard.js';
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

type Next = () => void;
type Guard = (
  port: () => number
) => (req: IncomingMessage, res: ServerResponse, next: Next) => void;

// The kit host and how it keeps other sites out: its own guard (an export, or a host option), else the cli's.
export interface KitHost {
  host: (dir: string, opts: HostOptions) => Promise<HostedExtension>;
  guard: Guard | null;
  kitGuards: boolean;
}

// The second of the two places that load the kit host as a value; feature checks on its exports.
const loadKitHost = async (): Promise<KitHost> => {
  const kit = (await import('@agentage/extension/host')) as Record<string, unknown> &
    typeof KitHostModule;
  const caps = Array.isArray(kit['capabilities']) ? (kit['capabilities'] as unknown[]) : [];
  const option = caps.includes('localOnly');
  const guard = typeof kit['localOnly'] === 'function' ? (kit['localOnly'] as Guard) : null;
  const host = (dir: string, opts: HostOptions) =>
    kit.hostExtension(dir, option ? ({ ...opts, localOnly: true } as HostOptions) : opts);
  return { host, guard, kitGuards: option };
};

export interface LocalUpDeps {
  build: (dir: string) => Promise<PackageBuild>;
  kit: () => Promise<KitHost>;
  stopped: () => Promise<string>;
}

export const localUpDeps: LocalUpDeps = {
  build: (dir) => buildPackage(dir),
  kit: loadKitHost,
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

const handlerOf = (kit: KitHost, app: RequestListener, port: () => number): RequestListener => {
  if (kit.kitGuards) return app;
  const guard = kit.guard?.(port);
  return guard ? (req, res) => guard(req, res, () => app(req, res)) : loopbackOnly(app, port);
};

const serve = async (kit: KitHost, hosted: HostedExtension): Promise<Server> => {
  let port = 0;
  const server = await listenFrom(handlerOf(kit, hosted.app as RequestListener, () => port));
  port = portOf(server);
  return server;
};

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
  kit: KitHost,
  deps: LocalUpDeps,
  json: boolean
) => {
  let server: Server | null = null;
  try {
    server = await serve(kit, hosted);
    const port = portOf(server);
    writeRecord(dir, {
      pid: process.pid,
      port,
      id: hosted.id,
      instance: (await hosted.health()).data.instance,
    });
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
  const done = await runHosted(
    dir,
    await kit.host(dir, { dataDir: dataDirOf(dir) }),
    kit,
    deps,
    json
  );
  console.log(`stopped   ${done.id} (${done.stoppedBy})`);
  if (done.stoppedBy === 'SIGINT') setExit(130);
  return done;
};
