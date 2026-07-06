import { describe, expect, it, vi } from 'vitest';
import { type FileStore, type VaultsConfig } from '@agentage/memory-core';
import { type ChannelDecision, type Discovery } from './discovery.js';
import {
  createCouchSyncManager,
  resolveMutationTarget,
  type CouchSyncManagerDeps,
} from './manager.js';

const config: VaultsConfig = {
  version: 1,
  default: 'acct',
  vaults: {
    acct: { path: '/tmp/acct', origin: [{ remote: 'agentage', interval: 0 }] },
    git: { path: '/tmp/git', origin: [{ remote: 'git@h:g.git' }] },
    local: { path: '/tmp/local' },
  },
};

const noopStore = (): FileStore => ({
  listMarkdown: async () => [],
  read: async () => null,
  write: async () => {},
  remove: async () => {},
});

const couchDecision: ChannelDecision = {
  kind: 'couch',
  endpoint: 'https://couch.test',
  db: 'mem_acct',
  tokenUrl: 'https://auth.test/couch-token',
};

const makeManager = (over: Partial<CouchSyncManagerDeps> = {}) => {
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

describe('resolveMutationTarget', () => {
  it('maps a bare ref to the default vault when it is an account vault', () => {
    expect(resolveMutationTarget(config, { ref: 'notes/x.md' })).toEqual({
      vault: 'acct',
      path: 'notes/x.md',
    });
  });

  it('honours an explicit @vault/ prefix', () => {
    expect(resolveMutationTarget(config, { ref: '@acct/a/b.md' })).toEqual({
      vault: 'acct',
      path: 'a/b.md',
    });
  });

  it('honours opts.vault over the default', () => {
    expect(resolveMutationTarget(config, { ref: 'z.md', opts: { vault: 'acct' } })).toEqual({
      vault: 'acct',
      path: 'z.md',
    });
  });

  it('returns null for git/local vaults and for non-file refs', () => {
    expect(resolveMutationTarget(config, { ref: '@git/z.md' })).toBeNull();
    expect(resolveMutationTarget(config, { ref: 'z.md', opts: { vault: 'local' } })).toBeNull();
    expect(resolveMutationTarget(config, { ref: '@acct' })).toBeNull();
    expect(resolveMutationTarget(config, {})).toBeNull();
  });

  it('resolves a single-vault config with no default', () => {
    const single: VaultsConfig = {
      version: 1,
      vaults: { only: { path: '/tmp/only', origin: [{ remote: 'agentage' }] } },
    };
    expect(resolveMutationTarget(single, { ref: 'n.md' })).toEqual({ vault: 'only', path: 'n.md' });
  });
});

describe('createCouchSyncManager.onWrite', () => {
  it('pushes a write on an account vault via the couch channel', async () => {
    const { mgr, couch } = makeManager();
    mgr.onWrite('write', { ref: 'notes/x.md' });
    await vi.waitFor(() => expect(couch.pushFileLive).toHaveBeenCalledWith('notes/x.md'));
    expect(couch.removeFile).not.toHaveBeenCalled();
  });

  it('tombstones a delete on an account vault', async () => {
    const { mgr, couch } = makeManager();
    mgr.onWrite('delete', { ref: 'notes/x.md' });
    await vi.waitFor(() => expect(couch.removeFile).toHaveBeenCalledWith('notes/x.md'));
    expect(couch.pushFileLive).not.toHaveBeenCalled();
  });

  it('never touches couch for a git or local vault mutation', async () => {
    const { mgr, couch, discovery } = makeManager();
    mgr.onWrite('write', { ref: '@git/z.md' });
    mgr.onWrite('edit', { ref: 'z.md', opts: { vault: 'local' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(couch.pushFileLive).not.toHaveBeenCalled();
    expect(discovery.channelFor).not.toHaveBeenCalled();
  });

  it('does not fire for read/search/list verbs', async () => {
    const { mgr, couch } = makeManager();
    mgr.onWrite('read', { ref: 'notes/x.md' });
    mgr.onWrite('list', {});
    await new Promise((r) => setTimeout(r, 20));
    expect(couch.pushFileLive).not.toHaveBeenCalled();
  });

  it('enqueues (no network) when signed out', async () => {
    const enqueued: string[] = [];
    const { mgr, couch, discovery } = makeManager({
      getBearer: async () => null,
      makeStatePersistence: () => ({
        load: async () => null,
        save: async (s) => {
          enqueued.push(...s.pending);
        },
      }),
    });
    mgr.onWrite('write', { ref: 'notes/x.md' });
    await vi.waitFor(() => expect(enqueued).toContain('notes/x.md'));
    expect(discovery.channelFor).not.toHaveBeenCalled();
    expect(couch.pushFileLive).not.toHaveBeenCalled();
  });

  it('a signed-out delete enqueues a durable deletion, zero network', async () => {
    const deletions: string[] = [];
    const { mgr, couch, discovery } = makeManager({
      getBearer: async () => null,
      makeStatePersistence: () => ({
        load: async () => null,
        save: async (s) => {
          deletions.push(...(s.deletions ?? []));
        },
      }),
    });
    mgr.onWrite('delete', { ref: 'notes/x.md' });
    await vi.waitFor(() => expect(deletions).toContain('notes/x.md'));
    expect(discovery.channelFor).not.toHaveBeenCalled();
    expect(couch.removeFile).not.toHaveBeenCalled();
  });

  it('a delete surviving a discovery failure is enqueued, never dropped', async () => {
    const deletions: string[] = [];
    const { mgr, couch } = makeManager({
      discovery: {
        channelFor: vi.fn(async () => {
          throw new Error('well-known unreachable');
        }),
        reset: vi.fn(),
      },
      makeStatePersistence: () => ({
        load: async () => null,
        save: async (s) => {
          deletions.push(...(s.deletions ?? []));
        },
      }),
    });
    mgr.onWrite('delete', { ref: 'notes/x.md' });
    await vi.waitFor(() => expect(deletions).toContain('notes/x.md'));
    expect(couch.removeFile).not.toHaveBeenCalled();
  });
});

describe('createCouchSyncManager.status and runNow', () => {
  it('reports one couch target with its cadence and zero pending', () => {
    const { mgr } = makeManager();
    expect(mgr.status()).toEqual([
      {
        vault: 'acct',
        channel: 'couch',
        intervalSeconds: 0,
        lastSync: undefined,
        lastError: undefined,
        pendingCount: 0,
        paused: undefined,
        running: false,
      },
    ]);
  });

  it('runNow pauses a signed-out target with zero network', async () => {
    const { mgr, couch, discovery } = makeManager({ getBearer: async () => null });
    const result = await mgr.runNow('acct');
    expect(result).toMatchObject({
      vault: 'acct',
      channel: 'couch',
      ok: true,
      paused: 'signed out',
    });
    expect(discovery.channelFor).not.toHaveBeenCalled();
    expect(couch.syncNow).not.toHaveBeenCalled();
    expect(mgr.status()[0]!.paused).toBe('signed out');
  });

  it('runNow throws for a vault that is not an account vault', async () => {
    const { mgr } = makeManager();
    await expect(mgr.runNow('git')).rejects.toThrow('not an account vault');
  });

  it('runNow completes a full cycle and records lastSync', async () => {
    const { mgr, couch } = makeManager();
    const result = await mgr.runNow('acct');
    expect(couch.syncNow).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ vault: 'acct', ok: true });
    expect(result.paused).toBeUndefined();
    expect(mgr.status()[0]!.lastSync).toBe('2026-01-01T00:00:00Z');
  });

  it('commits dirty local changes BEFORE syncNow, even when couch is unreachable', async () => {
    const order: string[] = [];
    const couch = {
      pushFileLive: vi.fn(async () => {}),
      removeFile: vi.fn(async () => {}),
      flushPending: vi.fn(async () => {
        order.push('flush');
      }),
      syncNow: vi.fn(async () => {
        order.push('sync');
        return { pushed: false, pulled: false, error: 'couch unreachable' };
      }),
    };
    const { mgr } = makeManager({
      makeCouchSync: () => couch,
      commitDirty: vi.fn(async (_path: string, message: string) => {
        order.push(message.startsWith('sync: couch') ? 'commit-post' : 'commit-pre');
        return { committed: message.startsWith('sync: couch') === false, skipped: false };
      }),
    });
    const result = await mgr.runNow('acct');
    // The dirty working tree is committed first, so a couch outage never loses the local truth.
    expect(order).toEqual(['commit-pre', 'flush', 'sync', 'commit-post']);
    expect(result).toMatchObject({ ok: false, committed: true, error: 'couch unreachable' });
    expect(mgr.status()[0]!.lastError).toBe('couch unreachable');
    expect(mgr.status()[0]!.lastSync).toBeUndefined();
  });

  it('flushes queued deletions on a manual run before the push/pull round', async () => {
    const { mgr, couch } = makeManager();
    await mgr.runNow('acct');
    expect(couch.flushPending).toHaveBeenCalledTimes(1);
    expect(couch.flushPending.mock.invocationCallOrder[0]!).toBeLessThan(
      couch.syncNow.mock.invocationCallOrder[0]!
    );
  });
});
