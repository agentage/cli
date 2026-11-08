import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@agentage/extension/tool';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import type { KitTool } from './kit-tool.js';
import type { Exec, Ran } from './release-guard.js';
import { runExtensionRelease } from './release.js';

const SHA = 'a'.repeat(40);
const NAME = '@agentage/extension-probe';
const ENV = { GITHUB_REF_NAME: 'v0.1.0', GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'agentage/probe' };

interface World {
  id?: string;
  npm?: string;
  offMaster?: boolean;
  record?: boolean;
  release?: boolean;
  onNpm?: string[];
  publishDenied?: boolean;
  stageFails?: boolean;
  uploadFails?: boolean;
}

const ran = (ok: boolean, text = ''): Ran =>
  ok ? { ok, out: text, err: '' } : { ok, out: '', err: text };

// git, gh, docker and npm as a tag push sees them; every call is logged.
const world =
  (w: World, calls: string[], seen: string[]): Exec =>
  async (cmd, args, env = {}) => {
    const call = [cmd, ...args].join(' ');
    calls.push(call);
    for (const name of Object.keys(env)) seen.push(`${cmd} ${name}`);
    if (call.startsWith('git merge-base')) return ran(!w.offMaster);
    if (call.startsWith('gh release download'))
      return w.record
        ? ran(true, JSON.stringify({ commit: SHA }))
        : ran(false, 'release not found');
    if (call.startsWith('gh release view')) return ran(Boolean(w.release));
    if (call.startsWith('gh release upload') || call.startsWith('gh release create'))
      return ran(!w.uploadFails, 'HTTP 403');
    if (cmd === 'docker') return ran(false, 'manifest unknown');
    if (call === 'npm --version') return ran(true, `${w.npm ?? '11.7.0'}\n`);
    if (args[0] === 'view')
      return (w.onNpm ?? []).includes(args[1] ?? '') ? ran(true, '0.1.0\n') : ran(false, 'E404');
    if (args[0] === 'publish') return ran(!w.publishDenied, 'E404 Not Found - PUT');
    if (args[0] === 'stage') return ran(!w.stageFails, 'E403 Forbidden');
    return ran(true);
  };

// A committed checkout: build refuses a dirty tree before the kit runs.
const checkout = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agentage-release-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return dir;
};

const release = async (w: World = {}, env: Record<string, string> = ENV) => {
  const calls: string[] = [];
  const seen: string[] = [];
  const dir = checkout();
  const parts = { pages: true, api: true, mcp: false, store: 'postgres' };
  const pkg = validateManifest({
    name: NAME,
    version: '0.1.0',
    engines: { agentage: '^0.5' },
    agentage: { id: w.id ?? 'probe', parts },
  });
  const tool: Partial<KitTool> = {
    readManifest: async () => pkg,
    build: async (opts) => (
      calls.push(`build push=${String(opts?.push)}`),
      { id: 'probe', version: '0.1.0', commit: SHA, buildTime: '', images: [] }
    ),
    buildLines: () => ['api ghcr.io/agentage/probe-api:0.1.0 sha256:bbbbbbbb pushed'],
  };
  const deps = {
    exec: () => world(w, calls, seen),
    tool: async () => tool as KitTool,
    env: { ...env },
  };
  const printed = await output(() => runExtensionRelease({ dir }, deps));
  return { ...printed, calls, seen, env: deps.env };
};

describe('extension release', () => {
  test('a new version: preflight, guard, build --push, a new release with the record, npm publish', async () => {
    const run = await release();
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      'PASS id: probe is not the template',
      `PASS master: ${SHA} is on master`,
      'PASS tag: v0.1.0 is the package.json version',
      'PASS npm: npm 11.7.0',
      'PASS guard: v0.1.0 has no record and no image: build',
      'api ghcr.io/agentage/probe-api:0.1.0 sha256:bbbbbbbb pushed',
      'PASS record: agentage-extension.json attached to release v0.1.0',
      `PASS npm: ${NAME}@0.1.0 published`,
    ]);
    expect(run.calls.filter((c) => c.startsWith('docker'))).toEqual([
      'docker manifest inspect ghcr.io/agentage/probe-pages:0.1.0',
      'docker manifest inspect ghcr.io/agentage/probe-api:0.1.0',
    ]);
    expect(run.calls).toContain('build push=true');
    expect(run.calls).toContain(
      'gh release create v0.1.0 dist/agentage-extension.json --title v0.1.0 --notes Images by digest: agentage-extension.json -R agentage/probe'
    );
    expect(run.calls).toContain('npm publish --access public --provenance --ignore-scripts');
  });

  test('a tag that already has a release gets the record uploaded to it', async () => {
    const run = await release({ release: true });
    expect(run.calls).toContain(
      'gh release upload v0.1.0 dist/agentage-extension.json -R agentage/probe'
    );
  });

  test('a re-run of a released commit keeps the images and record and only retries npm', async () => {
    const run = await release({ record: true, onNpm: [`${NAME}@0.1.0`] });
    expect(run.error).toBeNull();
    expect(run.lines.slice(-2)).toEqual([
      'PASS guard: v0.1.0 is released: npm only',
      `PASS npm: ${NAME}@0.1.0 is already on npm`,
    ]);
    expect(
      run.calls.filter(
        (c) =>
          c.startsWith('build') || c.startsWith('gh release upload') || c.startsWith('npm publish')
      )
    ).toEqual([]);
  });

  test('the starting point (id template) never releases', async () => {
    const run = await release({ id: 'template' });
    expect(run.error).toBe(
      'FAIL id: this repo is the starting point for extensions: create one, release that'
    );
    expect(run.calls).toEqual([]);
  });

  test('refuses a commit not on master, a tag that is not the version, and an npm without OIDC', async () => {
    expect((await release({ offMaster: true })).error).toBe(`FAIL master: ${SHA} is not on master`);
    const moved = await release({}, { ...ENV, GITHUB_REF_NAME: 'v0.2.0' });
    expect(moved.error).toBe(
      'FAIL tag: v0.2.0 is not v0.1.0, the package.json version; tag the commit that sets it'
    );
    const old = await release({ npm: '10.9.2' });
    expect(old.error).toBe('FAIL npm: npm 10.9.2 cannot publish with OIDC: needs npm >= 11.5.1');
    expect(old.calls.some((c) => c.startsWith('gh'))).toBe(false);
  });

  test('names the missing input instead of guessing it', async () => {
    const run = await release(
      {},
      { GITHUB_REF_NAME: 'v0.1.0', GITHUB_REPOSITORY: 'agentage/probe' }
    );
    expect(run.error).toBe('FAIL inputs: GITHUB_SHA is not set; run it on a tag push');
    expect(run.calls).toEqual([]);
  });

  test('a guard refusal is a FAIL guard line and nothing is built', async () => {
    const run = await release({ record: true }, { ...ENV, GITHUB_SHA: 'b'.repeat(40) });
    expect(run.error).toMatch(/^FAIL guard: v0\.1\.0 was released from a+, not b+/);
    expect(run.calls).not.toContain('build push=true');
  });

  test('a failed upload of the record stops before npm', async () => {
    const run = await release({ uploadFails: true });
    expect(run.error).toBe('FAIL record: HTTP 403');
    expect(run.calls.some((c) => c.startsWith('npm publish'))).toBe(false);
  });

  test('a direct publish that is not authorized is staged for approval', async () => {
    const run = await release({ publishDenied: true });
    expect(run.lines.at(-1)).toBe(
      `PASS npm: ${NAME}@0.1.0 staged for approval (direct publish not authorized: no validated trusted publisher)`
    );
    expect(run.calls).toContain('npm stage publish --access public --provenance --ignore-scripts');
    expect((await release({ publishDenied: true, stageFails: true })).error).toBe(
      'FAIL npm: E403 Forbidden'
    );
  });

  test('NPM_TOKEN stages the first publish of a new name; the token never lands on disk', async () => {
    const run = await release({}, { ...ENV, NPM_TOKEN: 'npm_secret' });
    expect(run.lines.at(-1)).toBe(
      `PASS npm: ${NAME}@0.1.0 staged for approval (a new name has no trusted publisher)`
    );
    const stage = run.calls.find((c) => c.startsWith('npm stage publish')) ?? '';
    const config = stage.split(' --userconfig ')[1] ?? '';
    expect(readFileSync(config, 'utf8')).toBe('//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n');
    expect(run.calls.some((c) => c.startsWith('npm publish'))).toBe(false);
  });

  test('NPM_TOKEN with a name already on npm publishes directly', async () => {
    const run = await release({ onNpm: [NAME] }, { ...ENV, NPM_TOKEN: 'npm_secret' });
    expect(run.lines.at(-1)).toBe(`PASS npm: ${NAME}@0.1.0 published`);
  });

  test('GH_TOKEN reaches gh only and NPM_TOKEN npm only; both leave the environment', async () => {
    const run = await release(
      { publishDenied: true },
      { ...ENV, GH_TOKEN: 'gh_x', NPM_TOKEN: 'npm_x' }
    );
    expect(run.error).toBeNull();
    expect([...new Set(run.seen)].sort()).toEqual(['gh GH_TOKEN', 'npm NPM_TOKEN']);
    expect(run.env).not.toHaveProperty('GH_TOKEN');
    expect(run.env).not.toHaveProperty('NPM_TOKEN');
    const fallback = await release({}, { ...ENV, GITHUB_TOKEN: 'gh_y' });
    expect([...new Set(fallback.seen)]).toEqual(['gh GH_TOKEN']);
  });
});
