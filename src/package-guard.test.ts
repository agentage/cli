import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from './plugin.js';

const SRC = join(import.meta.dirname, '.');
const PKG = join(import.meta.dirname, '..', 'package.json');
const CORE = join(SRC, 'core');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

// No product code in the CLI: memory, MCP and agent-runtime packages return only as plugins.
const FORBIDDEN = [
  '@agentage/core',
  '@agentage/platform',
  '@agentage/memory-core',
  '@agentage/server-memory',
  '@modelcontextprotocol/sdk',
  '@supabase/',
  "from 'express'",
  "from 'ws'",
  'better-sqlite3',
];

// Quote-anchored so static, re-export and dynamic imports from src/core all match.
const CORE_FORBIDDEN: RegExp[] = [
  /['"](\.\.\/)+(daemon|mcp|sync|lib\/memory|lib\/vault)\b/,
  /['"]express['"]/,
  /@agentage\/observability/,
];

describe('package guard (launcher core)', () => {
  it('source contains no product or agent-runtime imports', () => {
    for (const file of sourceFiles(SRC)) {
      const content = readFileSync(file, 'utf-8');
      for (const token of FORBIDDEN) {
        expect(content.includes(token), `${file} contains forbidden token "${token}"`).toBe(false);
      }
    }
  });

  it('core imports nothing product-shaped', () => {
    const files = sourceFiles(CORE);
    expect(files.length, 'src/core holds at least one source file').toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of CORE_FORBIDDEN) {
        expect(pattern.test(content), `${file} matches forbidden ${pattern}`).toBe(false);
      }
    }
  });

  it('exposes the plugin contract as a subpath export', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      exports: { './plugin'?: { default?: string } };
    };
    expect(pkg.exports['./plugin']?.default).toBe('./dist/plugin.js');
    expect(PLUGIN_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runtime dependencies are exactly the launcher core set', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      dependencies: Record<string, string>;
      bin: Record<string, string>;
    };
    // The telemetry kit plus its @opentelemetry/api peer (listed so one copy is hoisted).
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@agentage/observability',
      '@opentelemetry/api',
      'chalk',
      'commander',
      'open',
    ]);
    expect(pkg.bin['agentage']).toBe('./dist/cli.js');
  });

  it('no runtime dependency uses the "latest" specifier', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      expect(spec, `${name} must pin a semver range, not "latest"`).not.toBe('latest');
    }
  });

  it('homepage is set to the canonical site URL', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as { homepage: string };
    expect(pkg.homepage).toBe('https://agentage.io');
  });

  it('build script cleans dist before compiling', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as { scripts: Record<string, string> };
    // rmSync in the build command ensures stale dist files can't ship in a tarball
    expect(pkg.scripts['build']).toContain('rmSync');
    expect(pkg.scripts['build']).toContain('tsc');
  });
});
