import { type VaultsConfig } from '@agentage/memory-core';
import { describe, expect, it } from 'vitest';
import { type SyncStatus } from '../../sync/git/manager.js';
import { buildVaultStatuses } from './vaults-status.js';

const config = (vaults: VaultsConfig['vaults']): VaultsConfig => ({ version: 1, vaults });

const emptySync: SyncStatus = { vaults: [] };

describe('buildVaultStatuses channel classification', () => {
  it('classifies an agentage-origin vault as cloud', () => {
    const [v] = buildVaultStatuses(
      emptySync,
      true,
      config({ notes: { path: '~/notes', origin: [{ remote: 'agentage' }] } })
    );
    expect(v?.channel).toBe('cloud');
  });

  it('classifies an external-remote vault as git', () => {
    const [v] = buildVaultStatuses(
      emptySync,
      true,
      config({ work: { path: '~/work', origin: [{ remote: 'https://git.example/x.git' }] } })
    );
    expect(v?.channel).toBe('git');
  });

  it('classifies an origin-less vault as local', () => {
    const [v] = buildVaultStatuses(emptySync, true, config({ scratch: { path: '~/s' } }));
    expect(v?.channel).toBe('local');
  });
});

describe('buildVaultStatuses status states', () => {
  const gitVault = config({ work: { path: '~/work', origin: [{ remote: 'https://g/x.git' }] } });

  it('reports ok when the daemon has a last run and no error', () => {
    const sync: SyncStatus = {
      vaults: [{ vault: 'work', remote: 'r', intervalSeconds: 60, running: false, lastRun: 't' }],
    };
    expect(buildVaultStatuses(sync, true, gitVault)[0]?.status).toBe('ok');
  });

  it('reports error when the daemon reports a last error', () => {
    const sync: SyncStatus = {
      vaults: [
        { vault: 'work', remote: 'r', intervalSeconds: 60, running: false, lastError: 'boom' },
      ],
    };
    const [v] = buildVaultStatuses(sync, true, gitVault);
    expect(v?.status).toBe('error');
    expect(v?.lastError).toBe('boom');
  });

  it('reports syncing when a cycle is running', () => {
    const sync: SyncStatus = {
      vaults: [{ vault: 'work', remote: 'r', intervalSeconds: 60, running: true }],
    };
    expect(buildVaultStatuses(sync, true, gitVault)[0]?.status).toBe('syncing');
  });

  it('reports idle for a local-only vault even with the daemon up', () => {
    expect(buildVaultStatuses(emptySync, true, config({ s: { path: '~/s' } }))[0]?.status).toBe(
      'idle'
    );
  });

  it('reports unknown for a synced vault when the daemon is down', () => {
    expect(buildVaultStatuses(null, false, gitVault)[0]?.status).toBe('unknown');
  });

  it('folds couch-channel state (lastSync) into the cloud vault', () => {
    const sync: SyncStatus = {
      vaults: [],
      couch: [
        {
          vault: 'notes',
          channel: 'couch',
          intervalSeconds: 60,
          running: false,
          lastSync: '2026-07-08T18:40:00Z',
          pendingCount: 0,
        },
      ],
    };
    const [v] = buildVaultStatuses(
      sync,
      true,
      config({ notes: { path: '~/n', origin: [{ remote: 'agentage' }] } })
    );
    expect(v?.channel).toBe('cloud');
    expect(v?.status).toBe('ok');
    expect(v?.lastRun).toBe('2026-07-08T18:40:00Z');
  });

  it('returns an empty array when no vaults are configured', () => {
    expect(buildVaultStatuses(emptySync, true, config({}))).toEqual([]);
  });
});
