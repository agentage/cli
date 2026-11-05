import type * as Kit from '@agentage/extension/tool';
import { describe, expect, it, vi } from 'vitest';
import { kitVersion } from './kit-version.js';

// Startup never loads the kit: importing it from kit-version.ts fails this file.
vi.mock('@agentage/extension/tool', () => {
  throw new Error('kit-version.ts imported the kit');
});

describe('the kit version kit-shaped ranges are checked against', () => {
  it("is the installed kit's own KIT_VERSION, read without importing the kit", async () => {
    const kit = await vi.importActual<typeof Kit>('@agentage/extension/tool');
    expect(kitVersion()).toBe(kit.KIT_VERSION);
  });

  it('is 0.0.0 when the kit cannot be found, so no kit-shaped range fits', async () => {
    vi.resetModules();
    const missing = () => {
      throw new Error("Cannot find module '@agentage/extension/package.json'");
    };
    vi.doMock('node:module', () => ({ createRequire: () => ({ resolve: missing }) }));
    const fresh = await import('./kit-version.js');
    expect(fresh.kitVersion()).toBe('0.0.0');
    vi.doUnmock('node:module');
  });
});
