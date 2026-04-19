import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../utils/version.js', () => ({ VERSION: '0.99.9' }));
import type * as CoreModule from '@agentage/core';

vi.mock('@agentage/core', async (importActual) => {
  const actual = await importActual<typeof CoreModule>();
  return {
    ...actual,
    shell: vi.fn(),
  };
});

import { getActionRegistry, resetActionRegistry } from './actions.js';

describe('action registry bootstrap', () => {
  beforeEach(() => {
    resetActionRegistry();
  });

  it('registers the three built-in actions with expected manifests', () => {
    const names = getActionRegistry()
      .list()
      .map((m) => m.name)
      .sort();
    expect(names).toEqual(['agent:install', 'cli:update', 'project:addFromOrigin']);
  });

  it('each action declares a distinct capability and machine scope', () => {
    const manifests = getActionRegistry().list();
    const caps = new Set(manifests.map((m) => m.capability));
    expect(caps.size).toBe(manifests.length);
    for (const m of manifests) {
      expect(m.scope).toBe('machine');
      expect(m.capability).toMatch(/\.(read|write)$/);
    }
  });

  it('singleton returns the same registry across calls', () => {
    expect(getActionRegistry()).toBe(getActionRegistry());
  });
});
