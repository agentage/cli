import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import {
  changedDeps,
  ciClone,
  makeRepo,
  writeExtension,
  type Repo,
  type Spec,
  type World,
} from '../../test/release-repo.js';
import type { KitTool } from './kit-tool.js';
import { runRelease, type ExtensionReleaseOptions } from './release.js';

const REPO = 'agentage/examples';

type Run = { dir: string; w?: World; opts?: ExtensionReleaseOptions; env?: NodeJS.ProcessEnv };

const release = async ({ dir, w = {}, opts = {}, env }: Run, tool?: Partial<KitTool>) => {
  const calls: string[] = [];
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const deps = changedDeps(w, calls, env ?? { GITHUB_REPOSITORY: REPO, GITHUB_SHA: sha });
  const kit = tool ? { tool: async () => ({ ...(await deps.tool()), ...tool }) as KitTool } : {};
  let result: unknown;
  const printed = await output(async () => {
    result = await runRelease({ dir, changed: true, ...opts }, { ...deps, ...kit });
  });
  return { ...printed, result, calls, sha };
};

// Two extensions released on 2026-11-21 from the first commit; then only probe changes.
const twoExtensions = (records = true) => {
  const repo = makeRepo();
  writeExtension(repo, 'extensions/probe', 'probe');
  writeExtension(repo, 'extensions/fixture', 'fixture');
  const first = repo.commit('two extensions');
  repo.tag('probe@2026.1121.1');
  repo.tag('fixture@2026.1121.1');
  repo.write('extensions/probe/index.js', "export const id = 'probe 2';\n");
  repo.write('README.md', 'outside both folders\n');
  repo.commit('change probe');
  const recorded = { 'probe@2026.1121.1': first, 'fixture@2026.1121.1': first };
  return { repo, first, records: records ? recorded : { 'probe@2026.1121.1': first } };
};

const status = (dir: string) =>
  execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();

const remoteTags = (repo: Repo) => repo.git('ls-remote', '--tags', 'origin');

const oneExtension = (rel: string, id: string, spec?: Spec) => {
  const repo = makeRepo();
  writeExtension(repo, rel, id, spec);
  repo.commit('one');
  return repo;
};

describe('extension release --changed: what it releases', () => {
  test('a dry run on two extensions names only the changed one and changes nothing', async () => {
    const { repo, records } = twoExtensions();
    const dir = ciClone(repo);
    expect(execFileSync('git', ['tag', '-l'], { cwd: dir, encoding: 'utf8' })).toBe('');
    const tagsBefore = remoteTags(repo);
    const run = await release({ dir, w: { records }, opts: { dryRun: true } });
    expect(run.error).toBeNull();
    expect(run.lines).toEqual([
      `PASS master: ${run.sha} is on master`,
      'PASS unchanged: fixture (extensions/fixture) is the same as fixture@2026.1121.1',
      'PASS changed: probe (extensions/probe) differs from probe@2026.1121.1: release probe@2026.1122.1',
      'PASS dry run: would release probe@2026.1122.1; nothing was written, tagged, pushed or published',
    ]);
    expect(run.calls).toEqual([
      `gh release download fixture@2026.1121.1 -R ${REPO} -p agentage-extension.json -O -`,
    ]);
    expect(status(dir)).toBe('');
    expect(remoteTags(repo)).toBe(tagsBefore);
    expect(run.result).toMatchObject({ dryRun: true, unchanged: ['fixture'] });
  });

  test('a release: tag on the commit, images, the record with --target, npm; nothing committed', async () => {
    const { repo, records } = twoExtensions();
    const dir = ciClone(repo);
    const run = await release({ dir, w: { records } });
    expect(run.error).toBeNull();
    const tag = 'probe@2026.1122.1';
    expect(run.calls.filter((c) => !c.startsWith('gh release download fixture'))).toEqual([
      'npm --version',
      `gh api repos/${REPO}/git/refs -f ref=refs/tags/${tag} -f sha=${run.sha}`,
      `gh release download ${tag} -R ${REPO} -p agentage-extension.json -O -`,
      'docker manifest inspect ghcr.io/agentage/probe-pages:2026.1122.1',
      'build probe@2026.1122.1',
      `gh release view ${tag} -R ${REPO}`,
      `gh release create ${tag} dist/agentage-extension.json --title ${tag} --notes Images by digest: agentage-extension.json --target ${run.sha} -R ${REPO}`,
      'npm view @agentage/extension-probe@2026.1122.1 version',
      'npm publish --access public --provenance --ignore-scripts',
    ]);
    expect(run.lines).toContain('PASS version: probe is 2026.1122.1 in this CI copy only');
    expect(run.lines).toContain(`PASS tag: ${tag} created on ${run.sha}`);
    expect(status(dir)).toBe('M extensions/probe/package.json');
    const pkg = JSON.parse(readFileSync(join(dir, 'extensions/probe/package.json'), 'utf8'));
    expect(pkg.repository.url).toBe(`git+https://github.com/${REPO}.git`);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe(
      run.sha
    );
    expect(run.result).toEqual({
      released: [{ id: 'probe', version: '2026.1122.1', tag, built: true, published: true }],
      unchanged: ['fixture'],
    });
  });

  test('nothing changed: exit 0, nothing released, no tag, build or npm call', async () => {
    const repo = makeRepo();
    writeExtension(repo, 'extensions/probe', 'probe');
    writeExtension(repo, 'extensions/fixture', 'fixture');
    const first = repo.commit('two extensions');
    repo.tag('probe@2026.1121.1');
    repo.tag('fixture@2026.1121.1');
    const records = { 'probe@2026.1121.1': first, 'fixture@2026.1121.1': first };
    repo.write('README.md', 'only the readme\n');
    repo.commit('readme');
    const run = await release({ dir: ciClone(repo), w: { records } });
    expect(run.error).toBeNull();
    expect(run.result).toEqual({ released: [], unchanged: ['fixture', 'probe'] });
    expect(run.calls.every((c) => c.startsWith('gh release download'))).toBe(true);
  });

  test('a dropped run is caught up: a later commit that changes only the README releases probe', async () => {
    const { repo, records } = twoExtensions();
    repo.write('README.md', 'a later commit, outside both folders\n');
    repo.commit('readme only');
    const run = await release({ dir: ciClone(repo), w: { records }, opts: { dryRun: true } });
    expect(run.lines).toContain(
      'PASS changed: probe (extensions/probe) differs from probe@2026.1121.1: release probe@2026.1122.1'
    );
  });

  test('an extension with no <id>@* tag yet is changed', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe'));
    const run = await release({ dir, opts: { dryRun: true } });
    expect(run.lines).toContain(
      'PASS changed: probe (extensions/probe) has no probe@* tag yet: release probe@2026.1122.1'
    );
  });

  test('the root layout: one extension at the root, private, so no npm', async () => {
    const repo = oneExtension('.', 'root', { private: true });
    repo.tag('root@2026.1121.1');
    repo.write('index.js', 'changed\n');
    repo.commit('change');
    const dir = ciClone(repo);
    const run = await release({ dir });
    expect(run.error).toBeNull();
    expect(run.lines[1]).toBe(
      'PASS changed: root (.) differs from root@2026.1121.1: release root@2026.1122.1'
    );
    expect(run.lines).toContain('PASS npm: private package, not published');
    expect(run.calls.some((c) => c.startsWith('npm'))).toBe(false);
    expect(status(dir)).toBe('M package.json');
  });

  test('the second release of a day takes N + 1', async () => {
    const repo = oneExtension('extensions/probe', 'probe');
    const first = repo.git('rev-parse', 'HEAD');
    repo.tag('probe@2026.1122.1');
    repo.write('extensions/probe/index.js', 'two\n');
    repo.commit('two');
    const dir = ciClone(repo);
    const run = await release({ dir, w: { records: { 'probe@2026.1122.1': first } } });
    expect(run.error).toBeNull();
    expect(run.calls).toContain('build probe@2026.1122.2');
  });

  test('a last tag with no record (a failed release) is changed: a new N', async () => {
    const { repo, records } = twoExtensions(false);
    const run = await release({ dir: ciClone(repo), w: { records }, opts: { dryRun: true } });
    expect(run.lines).toContain(
      'PASS changed: fixture (extensions/fixture) equals fixture@2026.1121.1, which has no record: release fixture@2026.1122.1'
    );
  });

  test('a re-run of the commit its last tag is on resumes that version', async () => {
    const repo = oneExtension('extensions/probe', 'probe');
    repo.tag('probe@2026.1122.1');
    const dir = ciClone(repo);
    const sha = repo.git('rev-parse', 'HEAD');
    const w = { refFails: 'Reference already exists (HTTP 422)', refAt: sha };
    const run = await release({ dir, w });
    expect(run.error).toBeNull();
    expect(run.lines).toContain(
      'PASS changed: probe (extensions/probe) probe@2026.1122.1 is on this commit: resume it: release probe@2026.1122.1'
    );
    expect(run.lines).toContain(`PASS tag: probe@2026.1122.1 is on ${sha}`);
  });
});

describe('extension release --changed: the guards', () => {
  test('a tag on another commit is refused before any build', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe'));
    const w = { refFails: 'Reference already exists', refAt: 'b'.repeat(40) };
    const run = await release({ dir, w });
    expect(run.error).toContain(`is on ${'b'.repeat(40)}`);
    expect(run.error).toContain('a moved tag is refused');
    expect(run.calls.some((c) => c.startsWith('build'))).toBe(false);
  });

  test('a tag call that fails for another reason stops the release', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe'));
    const run = await release({ dir, w: { refFails: 'HTTP 403' } });
    expect(run.error).toBe('FAIL tag: HTTP 403');
  });

  test('a record check that cannot answer stops the release', async () => {
    const { repo } = twoExtensions();
    const run = await release({ dir: ciClone(repo), w: { downloadFails: 'HTTP 502' } });
    expect(run.error).toContain('FAIL changed: cannot tell whether fixture@2026.1121.1');
  });

  test('a commit that is not on master is refused', async () => {
    const repo = oneExtension('extensions/probe', 'probe');
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_SHA: 'c'.repeat(40) };
    const run = await release({ dir: ciClone(repo), env });
    expect(run.error).toContain(`FAIL master: ${'c'.repeat(40)} is not on master`);
  });

  test('inputs: no repo is refused; no GITHUB_SHA reads HEAD; outside git, it stops', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe'));
    expect((await release({ dir, env: {} })).error).toContain('GITHUB_REPOSITORY is not set');
    const head = await release({ dir, env: { GITHUB_REPOSITORY: REPO }, opts: { dryRun: true } });
    expect(head.lines[0]).toBe(`PASS master: ${head.sha} is on master`);
    const empty = mkdtempSync(join(tmpdir(), 'agentage-nogit-'));
    const outside = await output(() =>
      runRelease({ dir: empty, changed: true }, changedDeps({}, [], { GITHUB_REPOSITORY: REPO }))
    );
    expect(outside.error).toContain('FAIL inputs: git rev-parse');
  });

  test('a repo with no extension package is refused', async () => {
    const repo = makeRepo();
    repo.commit('nothing');
    const run = await release({ dir: ciClone(repo) });
    expect(run.error).toBe('FAIL folders: no extension package at the root or in extensions/*');
  });

  test('a file the run did not write makes the tree dirty: the build is refused', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe'));
    writeFileSync(join(dir, 'stray.txt'), 'x');
    const run = await release({ dir });
    expect(run.code).toBe('uncommitted_changes');
    expect(run.error).toContain('?? stray.txt');
    expect(run.calls.some((c) => c.startsWith('build'))).toBe(false);
  });

  test('the template id is refused before its tag', async () => {
    const dir = ciClone(oneExtension('.', 'template'));
    const run = await release({ dir });
    expect(run.error).toContain('FAIL id: this repo is the starting point');
    expect(run.calls.some((c) => c.startsWith('gh api'))).toBe(false);
  });

  test('--dry-run needs --changed; without --changed it is the v* release', async () => {
    const dir = ciClone(oneExtension('.', 'probe'));
    const deps = changedDeps({}, [], {});
    const dry = await output(() => runRelease({ dir, dryRun: true }, deps));
    expect(dry).toMatchObject({ code: 'invalid_argument', error: '--dry-run goes with --changed' });
    const tagged = await output(() => runRelease({ dir }, deps));
    expect(tagged.error).toContain('FAIL inputs: GITHUB_REF_NAME is not set');
  });
});

describe('extension release --changed: an api part', () => {
  test('its contracts carry the version: rewritten in the CI copy; the one image too', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe', { api: true }));
    const run = await release({ dir });
    expect(run.error).toBeNull();
    expect(run.calls).toContain('writeContracts');
    expect(run.calls).toContain('build probe@2026.1122.1 container');
    expect(run.calls).toContain('docker manifest inspect ghcr.io/agentage/probe:2026.1122.1');
    expect(status(dir).split('\n').sort()).toEqual([
      '?? extensions/probe/openapi.json',
      'M extensions/probe/package.json',
    ]);
  });

  test('a contract write that fails stops the release before its tag', async () => {
    const dir = ciClone(oneExtension('extensions/probe', 'probe', { api: true }));
    const writeContracts = async () => {
      throw new Error('dist is not built: run npm run build');
    };
    const run = await release({ dir }, { writeContracts });
    expect(run.error).toBe('FAIL contracts: dist is not built: run npm run build');
    expect(run.calls.some((c) => c.startsWith('gh api'))).toBe(false);
  });
});
