import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitVersion } from './core/kit-version.js';
import { defineExtension, EXTENSION_API_VERSION } from './extension.js';
import { compareVersions } from './lib/update/update-check.js';

const SRC = join(import.meta.dirname, '.');
const PKG = join(import.meta.dirname, '..', 'package.json');
const CORE = join(SRC, 'core');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

// No product code in the CLI: memory, MCP and agent-runtime packages return only as extensions.
const FORBIDDEN = [
  '@agentage/core',
  '@agentage/platform',
  '@agentage/memory-core',
  '@agentage/server-memory',
  '@modelcontextprotocol/sdk',
  '@agentage/observability',
  '@opentelemetry/',
  '@supabase/',
  "from 'express'",
  "import('express')",
  "from 'ws'",
  'better-sqlite3',
];

// Quote-anchored so static, re-export and dynamic imports from src/core all match.
const CORE_FORBIDDEN: RegExp[] = [
  /['"](\.\.\/)+(daemon|mcp|sync|lib\/memory|lib\/vault)\b/,
  /['"]express['"]/,
];

describe('package guard (the core)', () => {
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

  // `import { type X }` still emits `import {}` and loads the module; only `import type` is erased.
  it('only the daemon run (and its move) loads the app host; every other import is `import type`', () => {
    const files = sourceFiles(SRC).map((file) => [file, readFileSync(file, 'utf-8')] as const);
    const loaders = files.filter(([, text]) => text.includes("import('@agentage/apphost')"));
    expect(loaders.map(([file]) => file.slice(SRC.length + 1)).sort()).toEqual([
      'commands/daemon/move.ts',
      'commands/daemon/run.ts',
    ]);
    const statics =
      /^(?:import|export)\b(?!\s+type\b)[^;]*?from '@agentage\/(?:apphost|extension\/host)'/gm;
    for (const [file, text] of files) expect(text.match(statics), file).toBeNull();
  });

  it('exposes the extension contract and its test context as subpath exports', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      exports: Record<string, { default?: string } | undefined>;
    };
    expect(pkg.exports['./extension']?.default).toBe('./dist/extension.js');
    expect(pkg.exports['./extension/test']?.default).toBe('./dist/extension-test.js');
    expect(EXTENSION_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const extension = { register: () => ({}) };
    expect(defineExtension(extension)).toBe(extension);
  });

  // apphost, express and pglite: the daemon (the app host program); esbuild, postcss and tailwind: the kit's app build for
  // `extension up` (S1.2.3), optional kit peers resolved beside the kit.
  it('runtime dependencies are the core set plus what the app host and app build run on', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as {
      dependencies: Record<string, string>;
      bin: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@agentage/apphost',
      '@agentage/extension',
      '@electric-sql/pglite',
      '@tailwindcss/postcss',
      'chalk',
      'commander',
      'esbuild',
      'express',
      'open',
      'postcss',
      'tailwindcss',
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

  // 0.16.0: the hosted discovery record is whole and a child's output has its secrets masked.
  it('the kit is 0.16.0 or newer, in the range and in the installed tree', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as { dependencies: Record<string, string> };
    const floor = (pkg.dependencies['@agentage/extension'] ?? '').replace(/^\^/, '');
    expect(compareVersions(floor, '0.16.0')).toBeGreaterThanOrEqual(0);
    expect(compareVersions(kitVersion(), '0.16.0')).toBeGreaterThanOrEqual(0);
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
