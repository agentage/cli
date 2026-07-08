import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultsConfig } from '@agentage/memory-core';
import { createDirectClient } from './memory-client.js';

// Each test gets its own vault dir(s); memory-core git-inits them in place (autoInit).
const configFor = (vaults: { name: string; path: string }[], def?: string): VaultsConfig => ({
  version: 1,
  ...(def ? { default: def } : vaults.length === 1 ? { default: vaults[0]!.name } : {}),
  vaults: Object.fromEntries(
    vaults.map((v) => [v.name, { path: v.path, mcp: ['local'] as const }])
  ),
});

describe('DirectClient', () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'agentage-mc-'))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const single = () => {
    const vault = join(root, 'v');
    return { client: createDirectClient(configFor([{ name: 'main', path: vault }])), vault };
  };

  it('write -> read round-trips', async () => {
    const { client } = single();
    const receipt = await client.write('a.md', 'hello memory');
    expect(receipt.path).toBe('a.md');
    expect(receipt.rev).toMatch(/^[0-9a-f]{7,}$/);
    expect((await client.read('a.md')).body).toBe('hello memory');
  });

  it('search finds a written doc via git grep', async () => {
    const { client } = single();
    await client.write('notes/x.md', 'the quokka is a marsupial');
    const out = await client.search('quokka');
    expect(out.results.map((r) => r.path)).toEqual(['notes/x.md']);
    expect(out.results[0]!.snippet).toContain('quokka');
  });

  it('list returns a folder tree; delete removes and read then fails', async () => {
    const { client } = single();
    await client.write('a.md', 'one');
    await client.write('sub/b.md', 'two');
    const tree = await client.list(undefined);
    expect(tree.files).toBe(2);
    await client.delete('a.md');
    expect((await client.list(undefined)).files).toBe(1);
    await expect(client.read('a.md')).rejects.toThrow(/not found/);
  });

  it('edits via str_replace', async () => {
    const { client } = single();
    await client.write('a.md', 'alpha beta');
    await client.edit('a.md', { mode: 'str_replace', old_str: 'beta', new_str: 'BETA' });
    expect((await client.read('a.md')).body).toBe('alpha BETA');
  });

  it('routes by @vault prefix and by --vault', async () => {
    const client = createDirectClient(
      configFor([
        { name: 'work', path: join(root, 'work') },
        { name: 'notes', path: join(root, 'notes') },
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
    await expect(client.read('@nope/x.md')).rejects.toThrow(/Unknown vault/);
  });

  it('errors when no local vault is registered', async () => {
    const client = createDirectClient({ version: 1, vaults: {} });
    await expect(client.read('x.md')).rejects.toThrow(/no local vaults/);
  });

  it('delete of a missing doc reports not found', async () => {
    const { client } = single();
    await expect(client.delete('ghost.md')).rejects.toThrow(/not found/);
  });
});
