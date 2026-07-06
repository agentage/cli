import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // node:sqlite sits behind --experimental-sqlite on Node < 23.4 (the vault index needs
    // it); pass the flag to the workers. Harmless (accepted) on newer Node. (Vitest 4:
    // execArgv is a top-level test option; the old poolOptions.forks form was removed.)
    execArgv: ['--experimental-sqlite'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'src/cli.ts'],
      thresholds: {
        branches: 65,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
});
