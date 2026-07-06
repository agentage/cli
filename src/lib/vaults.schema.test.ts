import { describe, expect, it } from 'vitest';
import { isValidVaultName, VAULTS_SCHEMA_URL } from './vaults.schema.js';

describe('vaults.schema', () => {
  it('pins the public $schema url', () => {
    expect(VAULTS_SCHEMA_URL).toBe('https://agentage.io/schemas/vaults.schema.json');
  });

  it('accepts allowlist-safe names', () => {
    expect(isValidVaultName('scratch')).toBe(true);
    expect(isValidVaultName('My_Vault-1')).toBe(true);
  });

  it('rejects names that break the cloud-path allowlist', () => {
    expect(isValidVaultName('has spaces')).toBe(false);
    expect(isValidVaultName('a/b')).toBe(false);
    expect(isValidVaultName('')).toBe(false);
    expect(isValidVaultName('x'.repeat(65))).toBe(false);
  });
});
