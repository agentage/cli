import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuiltImage } from '@agentage/extension/tool';

export interface Ran {
  ok: boolean;
  out: string;
  err: string;
}

export type Exec = (cmd: string, args: string[], input?: string) => Promise<Ran>;

// Bounded by SIGKILL after `seconds` (0 = unbounded); a kill reads as "cannot tell".
export const execIn =
  (cwd: string, seconds = 0): Exec =>
  (cmd, args, input) =>
    new Promise((resolve) => {
      const opts = {
        cwd,
        timeout: seconds * 1000,
        killSignal: 'SIGKILL' as const,
        maxBuffer: 1 << 26,
      };
      const child = execFile(cmd, args, opts, (error, stdout, stderr) => {
        const why = error?.killed ? `timed out after ${seconds} s` : stderr ? '' : error?.message;
        resolve({ ok: !error, out: stdout, err: [stderr.trim(), why].filter(Boolean).join('\n') });
      });
      child.stdin?.end(input);
    });

export const RECORD = 'agentage-extension.json';
export const IMAGE_PARTS: readonly BuiltImage['part'][] = ['pages', 'ui', 'api', 'mcp', 'worker'];

export interface GuardInput {
  dir: string;
  tag: string;
  sha: string;
  repo: string;
  id: string;
  version: string;
  parts: readonly BuiltImage['part'][];
}

// Only "not found" means "not released"; any other failure stops the release, never rebuilds it.
const notFound = (ran: Ran, pattern: RegExp, what: string): void => {
  if (!pattern.test(ran.err)) throw new Error(`cannot tell whether ${what} exists: ${ran.err}`);
};

const reuse = async ({ dir, tag, sha }: GuardInput, json: string): Promise<'reuse'> => {
  const { commit } = JSON.parse(json) as { commit?: unknown };
  if (commit !== sha) {
    const moved = `${tag} was released from ${String(commit)}, not ${sha}`;
    throw new Error(`${moved}; a version's images never change: release a new version`);
  }
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist', RECORD), `${json.trimEnd()}\n`);
  return 'reuse';
};

// A released version is never rebuilt: its images and record stay as first pushed.
export const releaseGuard = async (g: GuardInput, exec: Exec): Promise<'build' | 'reuse'> => {
  const record = await exec('gh', [
    'release',
    'download',
    g.tag,
    '-R',
    g.repo,
    '-p',
    RECORD,
    '-O',
    '-',
  ]);
  if (record.ok) return reuse(g, record.out);
  notFound(
    record,
    /release not found|no assets match|no assets to download/,
    `the ${g.tag} release record`
  );
  for (const part of g.parts) {
    const image = `ghcr.io/agentage/${g.id}-${part}:${g.version}`;
    const ran = await exec('docker', ['manifest', 'inspect', image]);
    if (ran.ok)
      throw new Error(
        `${image} is already pushed but ${g.tag} has no record; release a new version`
      );
    // denied too: GHCR may answer it for a package that does not exist yet (a new part).
    notFound(ran, /manifest unknown|no such manifest|denied/, image);
  }
  return 'build';
};
