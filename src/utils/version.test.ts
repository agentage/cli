import { describe, it, expect } from 'vitest';
import { VERSION } from './version.js';

describe('version', () => {
  it('exports a semver version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('matches package.json version', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
