import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type LoadKitTool } from './kit-tool.js';
import { type Exec } from './release-guard.js';

const FORMAT = '{{.Label "com.docker.compose.project"}}\t{{.Ports}}';
const HERE = 'run agentage extension up here';

// The kit's projectName over its workingCopy (not exported from /tool): one project per real path.
export const ownProject = async (id: string, dir: string): Promise<string> => {
  const absolute = resolve(dir);
  const real = await realpath(absolute).catch(() => absolute);
  return `agentage-${id}-${createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
};

const rendered = async (dir: string): Promise<unknown> =>
  readFile(join(dir, '.agentage', 'compose.json'), 'utf8')
    .then((text) => (JSON.parse(text) as { name?: unknown }).name)
    .catch(() => undefined);

// As the kit's down decides: this path's project, or the legacy one only when compose.json names it.
const accepts = async (dir: string, id: string, holder: string): Promise<boolean> => {
  if (holder === (await ownProject(id, dir))) return true;
  return holder === `agentage-${id}` && (await rendered(dir)) === holder;
};

// The live signal: the row of the container that publishes the dev issuer's port, if any.
const issuerRow = async (exec: Exec): Promise<string | undefined> => {
  const ran = await exec('docker', ['ps', '--format', FORMAT]);
  if (!ran.ok) throw new Error(`cannot ask docker which stack is up: ${ran.err}`);
  return ran.out.split('\n').find((line) => line.includes(':4281->'));
};

const named = (project: string): string => {
  const id = /^agentage-([a-z][a-z0-9-]*)-[0-9a-f]{8}$/.exec(project)?.[1];
  return id ? `extension ${id} (${project})` : `compose project ${project}`;
};

// A dev token only from the stack `up` started in this folder, never from another one.
export const assertOwnStack = async (dir: string, exec: Exec, tool: LoadKitTool): Promise<void> => {
  const row = await issuerRow(exec);
  if (row === undefined) throw new Error(`no stack is up on localhost:4281: ${HERE}`);
  const holder = row.split('\t')[0] ?? '';
  if (!holder)
    throw new Error(
      `localhost:4281 is held by a container that is not from compose: stop it, then ${HERE}`
    );
  const { id } = (await (await tool()).readManifest(dir)).agentage;
  if (!(await accepts(dir, id, holder)))
    throw new Error(`the stack up is ${named(holder)}, not this folder: ${HERE}`);
};
