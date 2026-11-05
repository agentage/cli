import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { kitVersion } from './kit-version.js';

describe('the kit version kit-shaped ranges are checked against', () => {
  it("is the installed kit's own version, read without importing the kit", () => {
    const path = createRequire(import.meta.url).resolve('@agentage/extension/package.json');
    const { version } = JSON.parse(readFileSync(path, 'utf-8')) as { version: string };
    expect(kitVersion()).toBe(version);
    expect(kitVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
