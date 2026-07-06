import { execFile, type ExecFileException } from 'node:child_process';

// A tiny git-exec wrapper scoped to one vault working copy. memory-core keeps its own createGit
// private, so sync spawns git directly (cwd = vault path) with a full, ambient-config-free
// identity (CI runners have none) and no interactive prompts (so an unreachable remote fails fast
// instead of hanging on credentials).

export type GitErrorKind = 'unreachable' | 'lock' | 'conflict' | 'other';

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Classify a git failure by its stderr so callers can react: an unreachable remote and a held
// index.lock are both skip-and-retry (not crashes); a conflict drives the keep-both-sides path.
export const classifyGitError = (stderr: string): GitErrorKind => {
  const s = stderr.toLowerCase();
  if (/index\.lock|another git process|unable to create .*\.lock|cannot lock ref/.test(s))
    return 'lock';
  if (/conflict|could not apply|needs merge|automatic merge failed/.test(s)) return 'conflict';
  if (
    /could not read from remote|connection refused|could not resolve host|repository .* not found|does not appear to be a git repository|unable to access|no route to host|network is unreachable|permission denied \(publickey\)|host key verification failed|does not exist|failed to connect|remote end hung up/.test(
      s
    )
  )
    return 'unreachable';
  return 'other';
};

export class GitError extends Error {
  readonly kind: GitErrorKind;
  readonly stderr: string;
  readonly code: number;
  constructor(result: GitRunResult) {
    super(result.stderr.trim() || `git exited with code ${result.code}`);
    this.name = 'GitError';
    this.kind = classifyGitError(result.stderr);
    this.stderr = result.stderr;
    this.code = result.code;
  }
}

export interface SyncGit {
  // Never throws on a non-zero exit; returns the full result for the caller to branch on.
  exec(args: string[], opts?: { timeoutMs?: number }): Promise<GitRunResult>;
  // Throws GitError on a non-zero exit; returns stdout otherwise.
  run(args: string[], opts?: { timeoutMs?: number }): Promise<string>;
}

const IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'agentage sync',
  GIT_AUTHOR_EMAIL: 'sync@agentage.io',
  GIT_COMMITTER_NAME: 'agentage sync',
  GIT_COMMITTER_EMAIL: 'sync@agentage.io',
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
};

export const createSyncGit = (cwd: string): SyncGit => {
  const exec = (args: string[], opts: { timeoutMs?: number } = {}): Promise<GitRunResult> =>
    new Promise((resolve) => {
      execFile(
        'git',
        args,
        {
          cwd,
          env: { ...process.env, ...IDENTITY },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: opts.timeoutMs ?? 0,
        },
        (err: ExecFileException | null, stdout, stderr) => {
          const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
          resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      );
    });

  return {
    exec,
    async run(args, opts) {
      const result = await exec(args, opts);
      if (result.code !== 0) throw new GitError(result);
      return result.stdout;
    },
  };
};
