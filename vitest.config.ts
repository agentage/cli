import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'src/cli.ts', 'src/daemon-entry.ts'],
      thresholds: {
        branches: 65,
        functions: 70,
        lines: 70,
        statements: 70,
        // Per-directory floors so a single weak file cannot hide behind the global average.
        // Set a few points below the achieved numbers; raise as coverage grows.
        'src/lib/**': { branches: 78, functions: 83, lines: 90, statements: 87 },
        'src/sync/**': { branches: 75, functions: 75, lines: 87, statements: 85 },
      },
    },
  },
});
