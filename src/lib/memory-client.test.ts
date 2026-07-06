import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDirectClient } from './memory-client.js';
import { VaultsConfig, type VaultType } from './vaults.schema.js';

// Each test gets its own config dir (for the index) + vault dir(s).
const configFor = (vaults: { name: string; path: string; type?: VaultType }[]): VaultsConfig =>
  VaultsConfig.parse({
    version: 1,
    vaults: vaults.map((v) => ({
      name: v.name,
      path: v.path,
      ...(v.type === 'couchdb'
        ? { type: 'couchdb', server: 'agentage' }
        : v.type === 'git'
          ? { type: 'git', remote: 'git@x:y.git' }
          : { type: 'local' }),
    })),
  });

describe('DirectClient', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentage-mc-'));
    process.env['AGENTAGE_CONFIG_DIR'] = join(root, 'cfg');
  });
  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(root, { recursive: true, force: true });
  });

  const single = () => {
    const vault = join(root, 'v');
    return { client: createDirectClient(configFor([{ name: 'main', path: vault }])), vault };
  };

  it('write -> read round-trips', async () => {
    const { client } = single();
    await client.write('a.md', 'hello memory');
    const doc = await client.read('a.md');
    expect(doc.body).toBe('hello memory');
    expect(doc.vault).toBe('main');
  });

  it('search finds a written doc after its index refresh', async () => {
    const { client } = single();
    await client.write('notes/x.md', 'the quokka is a marsupial');
    const out = await client.search('quokka');
    expect(out.results.map((r) => r.path)).toEqual(['notes/x.md']);
  });

  it('list reflects writes and deletes; delete is soft', async () => {
    const { client } = single();
    await client.write('a.md', 'one');
    await client.write('b.md', 'two');
    expect((await client.list(undefined)).entries.map((e) => e.path).sort()).toEqual([
      'a.md',
      'b.md',
    ]);
    await client.delete('a.md');
    expect((await client.list(undefined)).entries.map((e) => e.path)).toEqual(['b.md']);
    await expect(client.read('a.md')).rejects.toThrow(/not found/);
  });

  it('edits via str_replace through the client', async () => {
    const { client } = single();
    await client.write('a.md', 'alpha beta');
    await client.edit('a.md', { oldStr: 'beta', newStr: 'BETA' });
    expect((await client.read('a.md')).body).toBe('alpha BETA');
  });

  it('routes by @vault/ prefix and by --vault', async () => {
    const work = join(root, 'work');
    const notes = join(root, 'notes');
    const client = createDirectClient(
      configFor([
        { name: 'work', path: work },
        { name: 'notes', path: notes },
      ])
    );
    await client.write('@work/a.md', 'in work');
    await client.write('a.md', 'in notes', { vault: 'notes' });
    expect((await client.read('@work/a.md')).body).toBe('in work');
    expect((await client.read('a.md', { vault: 'notes' })).body).toBe('in notes');
  });

  it('errors on an ambiguous or unknown vault', async () => {
    const client = createDirectClient(
      configFor([
        { name: 'a', path: join(root, 'a') },
        { name: 'b', path: join(root, 'b') },
      ])
    );
    await expect(client.read('x.md')).rejects.toThrow(/multiple vaults/);
    await expect(client.read('x.md', { vault: 'nope' })).rejects.toThrow(/unknown vault/);
  });

  it('enforces the 8 MB cap on account-synced (couchdb) vaults only', async () => {
    const client = createDirectClient(
      configFor([{ name: 'cloud', path: join(root, 'c'), type: 'couchdb' }])
    );
    const tooBig = 'x'.repeat(8 * 1024 * 1024 + 1);
    await expect(client.write('big.md', tooBig)).rejects.toThrow(/8 MB/);
  });

  it('bounds read output with a truncation flag', async () => {
    const { client } = single();
    await client.write('big.md', 'y'.repeat(1_000_050));
    const doc = await client.read('big.md');
    expect(doc.truncated).toBe(true);
    expect(doc.body.length).toBe(1_000_000);
  });
});
