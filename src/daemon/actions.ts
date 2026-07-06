import { type EditInput } from '@agentage/memory-core';
import {
  type ListOptions,
  type MemoryClient,
  type SearchOptions,
  type VerbOptions,
} from '../lib/memory-client.js';

export const MEMORY_VERBS = ['search', 'read', 'write', 'edit', 'list', 'delete'] as const;
export type MemoryVerb = (typeof MEMORY_VERBS)[number];

export const isMemoryVerb = (v: string): v is MemoryVerb =>
  (MEMORY_VERBS as readonly string[]).includes(v);

type WriteOptions = VerbOptions & { frontmatter?: Record<string, unknown> };

// Map one wire payload to the matching MemoryClient call. The daemon and the CLI share this verb
// set so a daemon request runs the exact method a DirectClient would run in-process (DO2).
export const dispatchMemory = (
  client: MemoryClient,
  verb: MemoryVerb,
  body: unknown
): Promise<unknown> => {
  const p = (body ?? {}) as Record<string, unknown>;
  switch (verb) {
    case 'search':
      return client.search(p['query'] as string, p['opts'] as SearchOptions | undefined);
    case 'read':
      return client.read(p['ref'] as string, p['opts'] as VerbOptions | undefined);
    case 'write':
      return client.write(
        p['ref'] as string,
        p['body'] as string,
        p['opts'] as WriteOptions | undefined
      );
    case 'edit':
      return client.edit(
        p['ref'] as string,
        p['op'] as Omit<EditInput, 'path'>,
        p['opts'] as VerbOptions | undefined
      );
    case 'list':
      return client.list(p['folder'] as string | undefined, p['opts'] as ListOptions | undefined);
    case 'delete':
      return client.delete(p['ref'] as string, p['opts'] as VerbOptions | undefined);
  }
  throw new Error(`unknown verb: ${verb as string}`);
};
