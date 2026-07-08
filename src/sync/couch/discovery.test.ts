import { describe, expect, it, vi } from 'vitest';
import { type FetchJson } from '@agentage/memory-core';
import { type ProvisionResult, type ProvisionStatus } from '../../lib/auth/provision.js';
import { createDiscovery } from './discovery.js';

// A well-known payload advertising the couch channel for the given vault names.
const payload = (vaults: string[]): { status: number; json: unknown } => ({
  status: 200,
  json: {
    git_endpoint: 'https://sync.test',
    ttl: 3600,
    couch_endpoint: 'https://couch.test',
    couch_token_url: 'https://auth.test/couch-token',
    couch_vaults: vaults.map((v) => ({ vault: v, db: `mem_${v}` })),
  },
});

const prov = (status: ProvisionStatus): ProvisionResult => ({ status, message: '' });

const make = (
  fetchJson: FetchJson,
  provision: () => Promise<ProvisionResult> = async () => prov('provisioned')
) =>
  createDiscovery({
    bootstrapHost: 'https://sync.test',
    fetchJson,
    provision: vi.fn(provision),
    now: () => 0,
  });

describe('createDiscovery', () => {
  it('resolves the couch channel and caches within the payload ttl', async () => {
    const fetchJson = vi.fn(async () => payload(['acct']));
    const d = make(fetchJson);
    expect(await d.channelFor('acct', 'tok')).toEqual({
      kind: 'couch',
      endpoint: 'https://couch.test',
      db: 'mem_acct',
      tokenUrl: 'https://auth.test/couch-token',
    });
    await d.channelFor('acct', 'tok');
    expect(fetchJson).toHaveBeenCalledTimes(1); // second call served from the ttl cache
  });

  it('provisions once and refreshes discovery once when the vault is missing', async () => {
    let present = false;
    const fetchJson = vi.fn(async () => payload(present ? ['acct'] : []));
    const provision = vi.fn(async () => {
      present = true;
      return prov('provisioned');
    });
    const d = createDiscovery({
      bootstrapHost: 'https://sync.test',
      fetchJson,
      provision,
      now: () => 0,
    });
    expect(await d.channelFor('acct', 'tok')).toMatchObject({ kind: 'couch', db: 'mem_acct' });
    expect(provision).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledTimes(2); // initial + one refresh after provisioning
  });

  it('pauses with a CHANNEL_DISABLED reason when provisioning cannot enable the channel', async () => {
    const fetchJson = vi.fn(async () => payload([])); // never advertises acct
    const d = make(fetchJson, async () => prov('disabled'));
    expect(await d.channelFor('acct', 'tok')).toEqual({
      kind: 'paused',
      reason: 'account sync is not enabled on this server',
    });
  });

  it('maps a conflict and an unauthenticated provision to distinct paused reasons', async () => {
    const conflict = make(
      vi.fn(async () => payload([])),
      async () => prov('conflict')
    );
    expect(await conflict.channelFor('acct', 'tok')).toEqual({
      kind: 'paused',
      reason: 'name conflicts with a memory on another channel',
    });
    const signedOut = make(
      vi.fn(async () => payload([])),
      async () => prov('unauthenticated')
    );
    expect(await signedOut.channelFor('acct', 'tok')).toEqual({
      kind: 'paused',
      reason: 'signed out',
    });
  });
});
