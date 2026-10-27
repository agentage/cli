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

// Quote-anchored so static, re-export and dynamic imports from src/core all match.
const CORE_FORBIDDEN: RegExp[] = [
  /['"](\.\.\/)+(daemon|mcp|sync|lib\/memory|lib\/vault)\b/,
  /['"]express['"]/,
  /@modelcontextprotocol\/sdk/,
  /@agentage\/memory-core/,
  /@agentage\/server-memory/,
  /@agentage\/observability/,
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

  it('runtime dependencies are exactly the minimal client set', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      dependencies: Record<string, string>;
      bin: Record<string, string>;
    };
    // @agentage/memory-core is the one local engine at M2-C (decision V7/V11-C). M3 adds the MCP
    // contract layer: @agentage/server-memory (the frozen 6-tool builder, wrapped verbatim) and
    // @modelcontextprotocol/sdk (stdio + Streamable HTTP transports). @agentage/observability is
    // the estate kit (+ its @opentelemetry/api peer, listed so one copy is hoisted): affordable
    // here because `agentage` is installed globally once, unlike npx-per-call server-memory, which
    // takes the kit optionally. Still minimal: no daemon.
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@agentage/memory-core',
      '@agentage/observability',
      '@agentage/server-memory',
      '@modelcontextprotocol/sdk',
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
