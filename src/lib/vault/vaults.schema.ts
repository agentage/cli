// The vaults.json format is owned by @agentage/memory-core (validateConfig / VaultsConfig).
// This module keeps the one CLI-surface piece memory-core does not: the editor-tooling $schema
// pointer written on create. Name validation re-exports memory-core's single source of truth.

// The public JSON Schema location (served by the landing). Written into the file on create so
// editors get autocomplete + inline validation; accepted-and-ignored on load. A fixed
// production URL by design: editor tooling fetches it regardless of the CLI's target FQDN.
export const VAULTS_SCHEMA_URL = 'https://agentage.io/schemas/vaults.schema.json';

// ADR-013 AA-4: every name stays a valid cloud path segment (`<sub>/<name>.git`). memory-core's
// schema accepts any string key, so the CLI guards the name at the add surface with its allowlist.
export { isValidVaultName, VAULT_NAME_PATTERN } from '@agentage/memory-core';
