import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execIn, IMAGE_PARTS, releaseGuard, type Exec, type Ran } from './release-guard.js';

const SHA = 'a'.repeat(40);
const id = 'probe';
const RECORD = { id, version: '0.1.0', commit: SHA, parts: {} };
const API = `ghcr.io/agentage/${id}-api:0.1.0`;
const PAGES = `ghcr.io/agentage/${id}-pages:0.1.0`; // the first image part the guard asks about

interface Released {
  record?: object;
  images?: string[];
  ghError?: string;
  dockerError?: string;
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
    if (cmd === 'gh') {
      if (w.ghHang) return hang(dir);
      if (w.ghError) return ran(false, w.ghError);
      return w.record
        ? ran(true, `${JSON.stringify(w.record, null, 2)}\n`)
        : ran(false, 'release not found');
    }
    if (w.dockerHang) return hang(dir);
    if (w.dockerError) return ran(false, w.dockerError);
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
    const denied = 'Get "https://ghcr.io/v2/x/manifests/0.1.0": denied';
    expect(await guard({ dockerError: denied })).toMatchObject({ code: 0, out: 'build' });
  });

  it('reuses the released record on a re-run of the same commit', async () => {
    const run = await guard({ record: RECORD, images: [API] });
    expect(run).toMatchObject({ code: 0, out: 'reuse' });
    const kept = readFileSync(join(run.dir, 'dist', 'agentage-extension.json'), 'utf8');
    expect(kept).toBe(`${JSON.stringify(RECORD, null, 2)}\n`);
  });

  it('refuses a tag moved to another commit', async () => {
    const run = await guard({ record: RECORD }, 'b'.repeat(40));
    expect(run.code).toBe(1);
    expect(run.err).toContain(`v0.1.0 was released from ${SHA}`);
  });

  it('refuses an image already pushed without a record, whichever part it is', async () => {
    for (const image of [API, `ghcr.io/agentage/${id}-worker:0.1.0`]) {
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
    };
    await expect(releaseGuard(input, missing)).rejects.toThrow(
      /cannot tell whether .* exists: .*ENOENT/
    );
  });
});
