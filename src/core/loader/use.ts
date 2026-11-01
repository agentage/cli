import { type ExtensionApi, type ExtensionUse } from '../../extension.js';
import { isRecord } from '../../lib/fs/json-file.js';
import { type DiscoveredExtension } from './discover.js';

export interface LoadedPeer {
  ext: DiscoveredExtension;
  facade: ExtensionApi;
}

type Method = (...args: unknown[]) => unknown;

// Only own function members cross, bound to the original, in a frozen object of their own.
export const facadeOf = (api: unknown): ExtensionApi => {
  const methods = Object.entries(isRecord(api) ? api : {}).filter(
    (entry): entry is [string, Method] => typeof entry[1] === 'function'
  );
  return Object.freeze(Object.fromEntries(methods.map(([name, fn]) => [name, fn.bind(api)])));
};

// `loaded` is keyed by id; only an extension `self` peer-depends on is reachable.
export const createUse = (
  self: DiscoveredExtension,
  loaded: ReadonlyMap<string, LoadedPeer>
): ExtensionUse =>
  ((id: string, options: { optional?: boolean } = {}) => {
    const peer = loaded.get(id);
    const peers = [...self.peers, ...self.optionalPeers];
    if (peer && peers.includes(peer.ext.pkg)) return peer.facade;
    if (options.optional) return undefined;
    throw new Error(`use("${id}"): not a loaded peer of ${self.id}`);
  }) as ExtensionUse;
