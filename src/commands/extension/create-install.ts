import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDaemon } from '../../lib/daemon/daemon-client.js';
import { hostClient, type HostClient } from '../../lib/daemon/host-client.js';
import { CliError } from '../../lib/json-output.js';
import { report, summaryOf } from './lifecycle.js';
import { buildPackage, npmIn, type Npm, type PackageBuild } from './package-build.js';

export interface CreateInstallDeps {
  npm: Npm;
  build: (dir: string) => Promise<PackageBuild>;
  daemon: () => Promise<{ port: number; host: HostClient }>;
  fetch: typeof fetch;
}

export const createInstallDeps: CreateInstallDeps = {
  npm: npmIn,
  build: (dir) => buildPackage(dir),
  daemon: async () => {
    const port = await ensureDaemon();
    return { port, host: hostClient(port) };
  },
  fetch: (...args) => fetch(...args),
};

interface Operation {
  security?: unknown[];
  parameters?: { required?: boolean }[];
}

// The public GET routes the package's openapi.json names that need no parameter (such as ping).
export const publicPaths = (dir: string): string[] => {
  const file = join(dir, 'openapi.json');
  if (!existsSync(file)) return [];
  const doc = JSON.parse(readFileSync(file, 'utf8')) as {
    paths?: Record<string, { get?: Operation }>;
  };
  return Object.entries(doc.paths ?? {})
    .filter(
      ([, { get }]) => get && !get.security?.length && !get.parameters?.some((p) => p.required)
    )
    .map(([path]) => path);
};

// The first of those that answers 2xx through the daemon.
const answering = async (deps: CreateInstallDeps, port: number, dir: string) => {
  for (const path of publicPaths(dir)) {
    const url = `http://127.0.0.1:${port}${path}`;
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (res?.ok) return url;
  }
  return null;
};

const conforms = async (dir: string, deps: CreateInstallDeps): Promise<void> => {
  const { report: checked } = await deps.build(dir);
  if (!checked.conforms)
    throw new CliError('not_conforming', `${dir} does not conform: agentage extension check`);
};

// After the scaffold: npm ci, the package build, then the daemon runs the folder (POST {source}).
export const installCreated = async (
  folder: string,
  install: boolean,
  deps = createInstallDeps
) => {
  const dir = resolve(folder);
  await deps.npm(dir, ['ci', '--no-audit', '--no-fund']);
  await conforms(dir, deps);
  if (!install) return { installed: null, url: null };
  if (process.env['AGENTAGE_NO_DAEMON'] === '1') {
    console.log(' install   the daemon is off (AGENTAGE_NO_DAEMON=1): not installed');
    return { installed: null, url: null };
  }
  const { port, host } = await deps.daemon();
  const installed = summaryOf(report(await host.add({ source: dir })));
  const url = await answering(deps, port, dir);
  console.log(url ? ` url       ${url}` : ' url       none answers yet: agentage extension list');
  return { installed, url };
};
