import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  execIn,
  IMAGE_PARTS,
  imagesOf,
  releaseGuard,
  type Exec,
  type Ran,
} from './release-guard.js';
import type { ExtensionPackage } from '@agentage/extension/tool';

const SHA = 'a'.repeat(40);
const id = 'probe';
const RECORD = { id, version: '0.1.0', commit: SHA, parts: {} };
const API = `ghcr.io/agentage/${id}-api:0.1.0`;
const PAGES = `ghcr.io/agentage/${id}-pages:0.1.0`; // the first image part the guard asks about

interface Released {
  record?: object;
  noContainerRecord?: boolean;
  images?: string[];
  ghError?: string;
  dockerError?: string;
  deniedImages?: string[];
  pkg?: 'none' | 'ours' | 'other' | 'error';
  ghHang?: boolean;
  dockerHang?: boolean;
}

const ran = (ok: boolean, text: string): Ran =>
  ok ? { ok, out: text, err: '' } : { ok, out: '', err: text };
const hang = (dir: string) => execIn(dir, 1)('sleep', ['5']);

// gh and docker answer as the real ones do (messages checked against both).
const registry =
  (w: Released, dir: string): Exec =>
  async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'api') {
      if (w.pkg === 'error') return ran(false, 'HTTP 502');
      if (w.pkg === 'ours' || w.pkg === 'other')
        return ran(
          true,
          JSON.stringify({
            repository: { full_name: w.pkg === 'ours' ? 'agentage/probe' : 'agentage/market' },
          })
        );
      return ran(false, 'gh: Not Found (HTTP 404)');
    }
    if (cmd === 'gh') {
      if (w.ghHang) return hang(dir);
      if (w.ghError) return ran(false, w.ghError);
      if (w.noContainerRecord && args.includes('agentage-container.json'))
        return ran(false, 'no assets match the file pattern');
      return w.record
        ? ran(true, `${JSON.stringify(w.record, null, 2)}\n`)
        : ran(false, 'release not found');
    }
    if (w.dockerHang) return hang(dir);
    if (w.dockerError) return ran(false, w.dockerError);
    if ((w.deniedImages ?? []).includes(args[2] ?? '')) return ran(false, 'unauthorized: denied');
    return (w.images ?? []).includes(args[2] ?? '')
      ? ran(true, '{}')
      : ran(false, 'manifest unknown');
  };

const guard = async (w: Released, sha = SHA) => {
  const dir = mkdtempSync(join(tmpdir(), 'release-guard-'));
  const input = {
    dir,
    tag: 'v0.1.0',
    sha,
    repo: 'agentage/probe',
    id,
    version: '0.1.0',
    parts: IMAGE_PARTS,
    oneImage: true,
  };
  const out = await releaseGuard(input, registry(w, dir)).then(
    (decision) => ({ code: 0, out: decision, err: '' }),
    (e: Error) => ({ code: 1, out: '', err: e.message })
  );
  return { dir, ...out };
};

describe('release guard', () => {
  it('builds a version with no release and no image', async () => {
    expect(await guard({})).toMatchObject({ code: 0, out: 'build', err: '' });
  });

  it('builds when the release exists with no record yet (a fresh tag)', async () => {
    expect(await guard({ ghError: 'no assets to download' })).toMatchObject({
      code: 0,
      out: 'build',
    });
  });

  it('builds the first image of a part when the registry denies a package it has never seen', async () => {
    expect(await guard({ deniedImages: [PAGES, API] })).toMatchObject({ code: 0, out: 'build' });
  });

  it('reuses the released record on a re-run of the same commit', async () => {
    const run = await guard({ record: RECORD, images: [API] });
    expect(run).toMatchObject({ code: 0, out: 'reuse' });
    const kept = readFileSync(join(run.dir, 'dist', 'agentage-extension.json'), 'utf8');
    expect(kept).toBe(`${JSON.stringify(RECORD, null, 2)}\n`);
  });

  it('refuses a reuse when the release has the part record but no container record', async () => {
    const run = await guard({ record: RECORD, noContainerRecord: true });
    expect(run).toMatchObject({ code: 1, out: '' });
    expect(run.err).toContain('has agentage-extension.json but no agentage-container.json');
  });

  const ONE = `ghcr.io/agentage/${id}:0.1.0`;

  it('builds when the one image is denied and the GitHub API has no such package (new name)', async () => {
    expect(await guard({ deniedImages: [ONE], pkg: 'none' })).toMatchObject({
      code: 0,
      out: 'build',
    });
  });

  it("builds when the one image is denied and the package is this repo's own", async () => {
    expect(await guard({ deniedImages: [ONE], pkg: 'ours' })).toMatchObject({
      code: 0,
      out: 'build',
    });
  });

  it('refuses a one-image name denied and owned by another repo, before any push', async () => {
    const run = await guard({ deniedImages: [ONE], pkg: 'other' });
    expect(run.code).toBe(1);
    expect(run.err).toContain('belongs to another package');
  });

  it('stops when the GitHub API cannot answer for a denied one-image name', async () => {
    const run = await guard({ deniedImages: [ONE], pkg: 'error' });
    expect(run.code).toBe(1);
    expect(run.err).toContain('cannot tell whether the package ghcr.io/agentage/probe exists');
  });

  it('refuses a tag moved to another commit', async () => {
    const run = await guard({ record: RECORD }, 'b'.repeat(40));
    expect(run.code).toBe(1);
    expect(run.err).toContain(`v0.1.0 was released from ${SHA}`);
  });

  it('refuses an image already pushed without a record, whichever part it is', async () => {
    for (const image of [
      API,
      `ghcr.io/agentage/${id}-worker:0.1.0`,
      `ghcr.io/agentage/${id}:0.1.0`,
    ]) {
      const run = await guard({ images: [image] });
      expect(run).toMatchObject({ code: 1, out: '' });
      expect(run.err).toBe(
        `${image} is already pushed but v0.1.0 has no record; release a new version`
      );
    }
  });

  it('stops when GitHub or the registry cannot answer, instead of rebuilding', async () => {
    const gh = await guard({ ghError: 'HTTP 401: Bad credentials' });
    expect(gh).toMatchObject({ code: 1, out: '' });
    expect(gh.err).toContain('cannot tell whether the v0.1.0 release record exists');
    expect(gh.err).toContain('HTTP 401: Bad credentials');
    const registry = await guard({ dockerError: 'received unexpected HTTP status: 503' });
    expect(registry).toMatchObject({ code: 1, out: '' });
    expect(registry.err).toContain(`cannot tell whether ${PAGES} exists`);
  });

  it('stops on a GitHub or registry call that hangs, naming the timeout', async () => {
    const gh = await guard({ ghHang: true });
    expect(gh).toMatchObject({ code: 1, out: '' });
    expect(gh.err).toContain('cannot tell whether the v0.1.0 release record exists');
    expect(gh.err).toContain('timed out after 1 s');
    const registry = await guard({ dockerHang: true });
    expect(registry).toMatchObject({ code: 1, out: '' });
    expect(registry.err).toContain(`cannot tell whether ${PAGES} exists`);
    expect(registry.err).toContain('timed out after 1 s');
  });

  it('reads a tool that is not on PATH as "cannot tell", never as "not released"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-guard-'));
    const missing: Exec = (_cmd, args) => execIn(dir, 1)('agentage-no-such-gh', args);
    const input = {
      dir,
      tag: 'v0.1.0',
      sha: SHA,
      repo: 'r',
      id,
      version: '0.1.0',
      parts: IMAGE_PARTS,
      oneImage: true,
    };
    await expect(releaseGuard(input, missing)).rejects.toThrow(
      /cannot tell whether .* exists: .*ENOENT/
    );
  });

  it('names the one image only for a package with a server part', () => {
    const of = (parts: Record<string, unknown>) =>
      imagesOf({ agentage: { parts } } as unknown as ExtensionPackage);
    expect(of({ api: true, mcp: false, store: 'postgres' })).toEqual({
      parts: ['api'],
      oneImage: true,
    });
    expect(of({ worker: true })).toEqual({ parts: ['worker'], oneImage: true });
    expect(of({ pages: true, ui: true })).toEqual({ parts: ['pages', 'ui'], oneImage: false });
  });
});
