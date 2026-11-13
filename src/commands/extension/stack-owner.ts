import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Exec } from './release-guard.js';

const LABEL = '{{.Label "com.docker.compose.project"}}';
const HERE = 'run agentage extension up here';

// The compose project `up` rendered in this folder: agentage-{id}-{folder hash}.
const ownProject = async (dir: string): Promise<string | undefined> => {
  const file = join(dir, '.agentage', 'compose.json');
  const doc = await readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as { name?: unknown })
    .catch(() => undefined);
  return typeof doc?.name === 'string' ? doc.name : undefined;
};

// The live signal: the compose project of the container that publishes the dev issuer's port.
const issuerProject = async (exec: Exec): Promise<string> => {
  const ran = await exec('docker', ['ps', '--filter', 'publish=4281', '--format', LABEL]);
  if (!ran.ok) throw new Error(`cannot ask docker which stack is up: ${ran.err}`);
  return ran.out.trim().split('\n')[0] ?? '';
};

const named = (project: string): string => {
  const id = /^agentage-([a-z][a-z0-9-]*)-[0-9a-f]{8}$/.exec(project)?.[1];
  return id ? `extension ${id} (${project})` : `compose project ${project}`;
};

// A dev token only from the stack `up` started in this folder, never from another one.
export const assertOwnStack = async (dir: string, exec: Exec): Promise<void> => {
  const holder = await issuerProject(exec);
  if (!holder) throw new Error(`no stack is up on localhost:4281: ${HERE}`);
  if (holder !== (await ownProject(dir)))
    throw new Error(`the stack up is ${named(holder)}, not this folder: ${HERE}`);
};
