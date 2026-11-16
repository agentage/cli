import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuiltImage, ExtensionPackage } from '@agentage/extension/tool';

export type Ran = { ok: boolean; out: string; err: string };

export type Exec = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<Ran>;

const ran = (error: Error | null, out: string, err: string): Ran => ({ ok: !error, out, err });

// Bounded by SIGKILL after `seconds` (0 = unbounded); a kill reads as "cannot tell".
export const execIn =
  (cwd: string, seconds = 0): Exec =>
  (cmd, args, env) =>
    new Promise((resolve) => {
      const limits = {
        timeout: seconds * 1000,
        killSignal: 'SIGKILL' as const,
        maxBuffer: 1 << 26,
      };
      const opts = { cwd, env: { ...process.env, ...env }, ...limits };
      const child = execFile(cmd, args, opts, (e, out, err) => {
        const why = e?.killed ? `timed out after ${seconds} s` : err ? '' : e?.message;
        resolve(ran(e, out, [err.trim(), why].filter(Boolean).join('\n')));
      });
      child.stdin?.end();
    });

export const RECORD = 'agentage-extension.json';
// The record of the one image (build --container --push), attached beside RECORD.
export const CONTAINER_RECORD = 'agentage-container.json';
export const IMAGE_PARTS: readonly BuiltImage['part'][] = ['pages', 'ui', 'api', 'mcp', 'worker'];

const declared = (pkg: ExtensionPackage, part: string) =>
  ((pkg.agentage.parts as Record<string, unknown>)[part] ?? false) !== false;

// The part images, and the one image when the package has a server part for it to run.
export const imagesOf = (pkg: ExtensionPackage) => ({
  parts: IMAGE_PARTS.filter((part) => declared(pkg, part)),
  oneImage: ['api', 'mcp', 'worker'].some((part) => declared(pkg, part)),
});

export type GuardInput = Record<'dir' | 'tag' | 'sha' | 'repo' | 'id' | 'version', string> & {
  parts: readonly BuiltImage['part'][];
  oneImage: boolean;
};

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

const refsOf = (g: GuardInput): string[] => [
  ...g.parts.map((part) => `ghcr.io/agentage/${g.id}-${part}:${g.version}`),
  ...(g.oneImage ? [`ghcr.io/agentage/${g.id}:${g.version}`] : []),
];

const ensureNoImages = async (g: GuardInput, exec: Exec): Promise<void> => {
  for (const image of refsOf(g)) {
    const ran = await exec('docker', ['manifest', 'inspect', image]);
    if (ran.ok)
      throw new Error(
        `${image} is already pushed but ${g.tag} has no record; release a new version`
      );
    // denied too: GHCR may answer it for a package that does not exist yet (a new part or the one image).
    notFound(ran, /manifest unknown|no such manifest|denied/, image);
  }
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
  await ensureNoImages(g, exec);
  return 'build';
};
