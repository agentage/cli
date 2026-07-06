import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '.');
const PKG = join(import.meta.dirname, '..', 'package.json');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

// R6 (amended for M2.5, DO10): the local daemon is now a sanctioned feature, so the
// daemon-entry / ensure-daemon / :4243 strip markers are dropped. The agent-runtime bans stay.
const FORBIDDEN = [
  '@agentage/core',
  '@agentage/platform',
  '@supabase/',
  "from 'express'",
  "from 'ws'",
  'better-sqlite3',
];

describe('package guard (R6)', () => {
  it('source contains no agent-runtime remnants', () => {
    for (const file of sourceFiles(SRC)) {
      const content = readFileSync(file, 'utf-8');
      for (const token of FORBIDDEN) {
        expect(content.includes(token), `${file} contains forbidden token "${token}"`).toBe(false);
      }
    }
  });

  it('runtime dependencies are exactly the minimal client set', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      dependencies: Record<string, string>;
      bin: Record<string, string>;
    };
    // @agentage/memory-core is the one local engine at M2-C (decision V7/V11-C); it replaces
    // the retired FTS5/SQLite stack and the direct zod/yaml deps. Still minimal: no daemon.
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@agentage/memory-core',
      'chalk',
      'commander',
      'open',
    ]);
    expect(pkg.bin['agentage']).toBe('./dist/cli.js');
  });
});
