import { channelForVault, HostResolver, type FetchJson } from '@agentage/memory-core';
import { type ProvisionResult } from '../../lib/provision.js';

// Resolves which channel each account vault syncs on, from GET /.well-known/agentage-sync
// (cached for the payload ttl in memory only). A vault absent from couch_vaults is provisioned
// once (idempotent) then discovery is refreshed once; if it is still absent the target pauses with
// a reason and retries next tick. A signed-out caller never reaches here (zero network).

export type ChannelDecision =
  | { kind: 'couch'; endpoint: string; db: string; tokenUrl: string }
  | { kind: 'paused'; reason: string };

export interface DiscoveryDeps {
  bootstrapHost: string; // the sync origin, e.g. https://sync.<fqdn>
  fetchJson: FetchJson;
  provision: (vault: string) => Promise<ProvisionResult>;
  now?: () => number;
}

export interface Discovery {
  channelFor(vault: string, token: string): Promise<ChannelDecision>;
  reset(): void;
}

const pausedReason = (prov: ProvisionResult): string => {
  switch (prov.status) {
    case 'disabled':
      return 'account sync is not enabled on this server';
    case 'conflict':
      return 'name conflicts with a memory on another channel';
    case 'unauthenticated':
      return 'signed out';
    default:
      return 'provisioning - will retry';
  }
};

export const createDiscovery = (deps: DiscoveryDeps): Discovery => {
  const resolver = new HostResolver(deps.bootstrapHost, deps.fetchJson, deps.now ?? Date.now);
  const toCouch = (ch: ReturnType<typeof channelForVault>): ChannelDecision | null =>
    ch.channel === 'couch'
      ? { kind: 'couch', endpoint: ch.endpoint, db: ch.db, tokenUrl: ch.tokenUrl }
      : null;
  return {
    async channelFor(vault, token) {
      const first = toCouch(channelForVault(await resolver.resolve(token), vault));
      if (first) return first;
      // Missing from couch_vaults: provision once, refresh discovery once, re-check.
      const prov = await deps.provision(vault);
      resolver.invalidate();
      const second = toCouch(channelForVault(await resolver.resolve(token), vault));
      return second ?? { kind: 'paused', reason: pausedReason(prov) };
    },
    reset() {
      resolver.invalidate();
    },
  };
};
