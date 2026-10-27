import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Run npm as `node npm-cli.js` so no shell or platform shim sits between the test and npm.
export const resolveNpmCli = (): string => {
  const bundled = join(
    dirname(process.execPath),
    '..',
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  if (existsSync(bundled)) return bundled;
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv?.endsWith('npm-cli.js')) return fromEnv;
  throw new Error(`npm-cli.js not found next to ${process.execPath}`);
};
