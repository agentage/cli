import { describe, expect, it, vi } from 'vitest';
import { type ChannelDecision } from './discovery.js';
import { makeManager } from './manager.fixtures.js';

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

  it('defers a write to the pending queue when signed in but the channel is not couch-ready', async () => {
    const pending: string[] = [];
    const { mgr, couch } = makeManager({
      discovery: {
        channelFor: vi.fn(async (): Promise<ChannelDecision> => ({
          kind: 'paused',
          reason: 'not provisioned',
        })),
        reset: vi.fn(),
      },
      makeStatePersistence: () => ({
        load: async () => null,
        save: async (s) => {
          pending.push(...s.pending);
        },
      }),
    });
    mgr.onWrite('write', { ref: 'notes/y.md' });
    await vi.waitFor(() => expect(pending).toContain('notes/y.md'));
    expect(couch.pushFileLive).not.toHaveBeenCalled();
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
