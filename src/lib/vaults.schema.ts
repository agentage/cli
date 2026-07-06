// The vaults.json format is owned by @agentage/memory-core (validateConfig / VaultsConfig).
// This module keeps only the two CLI-surface pieces memory-core does not: the editor-tooling
// $schema pointer written on create, and the vault-name allowlist enforced at `vault add`.

// The public JSON Schema location (served by the landing). Written into the file on create so
// editors get autocomplete + inline validation; accepted-and-ignored on load. A fixed
// production URL by design: editor tooling fetches it regardless of the CLI's target FQDN.
export const VAULTS_SCHEMA_URL = 'https://agentage.io/schemas/vaults.schema.json';

// ADR-013 AA-4: every name stays a valid cloud path segment (`<sub>/<name>.git`). memory-core's
// schema accepts any string key, so the CLI guards the name at the add surface.
const VAULT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isValidVaultName = (name: string): boolean => VAULT_NAME_RE.test(name);
