import { vi } from 'vitest';
import { type FileStore, type VaultsConfig } from '@agentage/memory-core';
import { type ChannelDecision, type Discovery } from './discovery.js';
import { createCouchSyncManager, type CouchSyncManagerDeps } from './manager.js';

export const config: VaultsConfig = {
  version: 1,
  default: 'acct',
  vaults: {
    acct: { path: '/tmp/acct', origin: [{ remote: 'agentage', interval: 0 }] },
    git: { path: '/tmp/git', origin: [{ remote: 'git@h:g.git' }] },
    local: { path: '/tmp/local' },
  },
};

export const autoConfig: VaultsConfig = {
  version: 1,
  default: 'acct',
  vaults: {
    acct: { path: '/tmp/acct', origin: [{ remote: 'agentage', interval: 300 }] },
    two: { path: '/tmp/two', origin: [{ remote: 'agentage', interval: 300 }] },
  },
};

export const noopStore = (): FileStore => ({
  listMarkdown: async () => [],
  read: async () => null,
  write: async () => {},
  remove: async () => {},
});

export const couchDecision: ChannelDecision = {
  kind: 'couch',
  endpoint: 'https://couch.test',
  db: 'mem_acct',
  tokenUrl: 'https://auth.test/couch-token',
};

export const makeManager = (over: Partial<CouchSyncManagerDeps> = {}) => {
  const couch = {
    pushFileLive: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
    flushPending: vi.fn(async () => {}),
    syncNow: vi.fn(async () => ({ pushed: true, pulled: true })),
  };
  const discovery: Discovery = {
    channelFor: vi.fn(async () => couchDecision),
    reset: vi.fn(),
  };
  const mgr = createCouchSyncManager({
    getConfig: () => config,
    configDir: () => '/tmp/cfg',
    getBearer: async () => 'tok',
    discovery,
    makeCouchSync: () => couch,
    makeFileStore: noopStore,
    makeStatePersistence: () => ({ load: async () => null, save: async () => {} }),
    commitDirty: async () => ({ committed: false, skipped: false }),
    now: () => '2026-01-01T00:00:00Z',
    ...over,
  });
  return { mgr, couch, discovery };
};
