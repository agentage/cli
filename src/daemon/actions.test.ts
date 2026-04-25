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

  it('registers the built-in actions with expected manifests', () => {
    const names = getActionRegistry()
      .list()
      .map((m) => m.name)
      .sort();
    expect(names).toEqual([
      'agent:install',
      'cli:update',
      'project:addFromOrigin',
      'vault:add',
      'vault:edit',
      'vault:files',
      'vault:list',
      'vault:read',
      'vault:reindex',
      'vault:remove',
      'vault:search',
    ]);
  });

  it('every action is machine-scoped with a namespace.verb capability', () => {
    const manifests = getActionRegistry().list();
    for (const m of manifests) {
      expect(m.scope).toBe('machine');
      expect(m.capability).toMatch(/^[a-z][a-z0-9-]*\.(read|write|admin)$/);
    }
  });

  it('singleton returns the same registry across calls', () => {
    expect(getActionRegistry()).toBe(getActionRegistry());
  });
});
