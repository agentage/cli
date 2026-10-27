import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.fixtures.ts',
        '**/index.ts',
        'src/cli.ts',
      ],
      thresholds: {
        branches: 65,
        functions: 70,
        lines: 70,
        statements: 70,
        // Per-directory floors so a single weak file cannot hide behind the global average.
        // Set a few points below the achieved numbers; raise as coverage grows.
        'src/lib/**': { branches: 78, functions: 83, lines: 90, statements: 87 },
        // New code starts high: the core is all injected deps, so it has no excuse to be untested.
        'src/core/**': { branches: 80, functions: 85, lines: 90, statements: 90 },
      },
    },
  },
});
