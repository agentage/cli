import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveVaultsConfig, vaultsJsonPath } from '../lib/vault/vaults.js';
import { createClientProvider } from './client-provider.js';

let dir: string;
const saved = process.env['AGENTAGE_CONFIG_DIR'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-provider-'));
  process.env['AGENTAGE_CONFIG_DIR'] = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env['AGENTAGE_CONFIG_DIR'];
  else process.env['AGENTAGE_CONFIG_DIR'] = saved;
});

describe('createClientProvider', () => {
  it('builds a client even with no vaults.json on disk', () => {
    const provider = createClientProvider();
    expect(typeof provider()).toBe('object');
  });

  it('caches the client until vaults.json changes on disk', () => {
    saveVaultsConfig({ version: 1, vaults: {} });
    const provider = createClientProvider();
    const first = provider();
    expect(provider()).toBe(first);

    const future = new Date(Date.now() + 5000);
    utimesSync(vaultsJsonPath(), future, future);
    expect(provider()).not.toBe(first);
  });
});
