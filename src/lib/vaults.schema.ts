import { z } from 'zod';

// The public JSON Schema location (served by the landing). Written into the file on
// create so editors get autocomplete + inline validation; accepted-and-ignored on load.
// A fixed production URL by design: editor tooling fetches it regardless of the CLI's
// target FQDN, so it is intentionally not derived from AGENTAGE_SITE_FQDN.
export const VAULTS_SCHEMA_URL = 'https://agentage.io/schemas/vaults.schema.json';

// ADR-013 AA-4: every name stays a valid cloud path segment (`<sub>/<name>.git`).
export const VaultName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid vault name');

const Base = z.object({ name: VaultName, path: z.string() }).strict();

// Setting `ignore` REPLACES these defaults ([] = sync everything).
const SyncIgnore = z.array(z.string()).default(['.obsidian/', 'data.json']);
// false = the daemon skips the vault; manual `vault sync <name>` only.
const SyncAuto = z.boolean().default(true);

export const Vault = z.discriminatedUnion('type', [
  Base.extend({ type: z.literal('local') }),
  Base.extend({
    type: z.literal('git'),
    remote: z.string().min(1),
    sync: z
      .object({
        auto: SyncAuto,
        interval: z.string().default('5m'),
        message: z.string().default('vault: auto-sync'),
        ignore: SyncIgnore,
      })
      .strict()
      // prefault (not default) so zod 4 re-parses `{}` and applies the inner defaults
      .prefault({}),
  }),
  Base.extend({
    type: z.literal('couchdb'),
    // A raw CouchDB URL for self-hosted is a later extension.
    server: z.literal('agentage').default('agentage'),
    sync: z
      .object({
        auto: SyncAuto,
        mode: z.enum(['continuous', 'interval']).default('continuous'),
        ignore: SyncIgnore,
      })
      .strict()
      // prefault (not default) so zod 4 re-parses `{}` and applies the inner defaults
      .prefault({}),
  }),
]);
export type Vault = z.infer<typeof Vault>;
export type VaultType = Vault['type'];

// `git` cannot be a discovery type (it needs a remote) - use `vault add --git`.
export const Discover = z
  .object({
    path: z.string(),
    type: z.enum(['couchdb', 'local']).default('couchdb'),
    // seeds discovered entries' sync.auto
    autosync: z.boolean().default(true),
    ignore: z.array(z.string()).default(['.*', '_*']),
  })
  .strict();
export type Discover = z.infer<typeof Discover>;

export const VaultsConfig = z
  .object({
    // editor-tooling pointer, written on create, otherwise ignored
    $schema: z.string().optional(),
    version: z.literal(1),
    discover: z.array(Discover).default([]),
    vaults: z.array(Vault).default([]),
  })
  .strict()
  .refine((c) => new Set(c.vaults.map((v) => v.name)).size === c.vaults.length, {
    message: 'duplicate vault name',
  });
export type VaultsConfig = z.infer<typeof VaultsConfig>;
