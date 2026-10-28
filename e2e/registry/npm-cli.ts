import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface NpmCli {
  runNpm: (
    args: string[],
    opts: { env?: NodeJS.ProcessEnv; timeoutMs: number }
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
}

// The shipped dist module, by computed path so type-check:e2e never needs a build first.
export const loadNpmCli = async (): Promise<NpmCli> =>
  (await import(
    pathToFileURL(join(process.cwd(), 'dist', 'lib', 'npm', 'npm-cli.js')).href
  )) as NpmCli;
