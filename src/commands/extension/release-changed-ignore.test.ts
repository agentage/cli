import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { ciClone, makeRepo, release, writeExtension, type Repo } from '../../test/release-repo.js';

// One extension at `rel`, released from the first commit; `files` then change on a second.
const changedAfterTag = (rel: string, files: string[], ignoreFile?: string) => {
  const repo = makeRepo();
  writeExtension(repo, rel, 'probe');
  const at = (f: string) => (rel === '.' ? f : `${rel}/${f}`);
  if (ignoreFile !== undefined) repo.write(at('.release-ignore'), ignoreFile);
  const first = repo.commit('base');
  repo.tag('probe@2026.1121.1');
  for (const f of files) repo.write(at(f), `changed ${f}\n`);
  repo.commit('change');
  return { repo, records: { 'probe@2026.1121.1': first } };
};

const plan = async (repo: Repo, records: Record<string, string>) =>
  release({ dir: ciClone(repo), w: { records }, opts: { dryRun: true } });

const CHANGED = 'PASS changed: probe (.) differs from probe@2026.1121.1 in';

describe('extension release --changed: files that do not release', () => {
  test('root layout: only the workflow, docs and markdown changed: nothing is released', async () => {
    const files = ['.github/workflows/release.yml', 'README.md', 'docs/guide.txt'];
    const { repo, records } = changedAfterTag('.', files);
    const run = await release({ dir: ciClone(repo), w: { records } });
    expect(run.error).toBeNull();
    expect(run.lines).toContain(
      'PASS unchanged: probe (.) is the same as probe@2026.1121.1; only ignored files changed: .github/workflows/release.yml, README.md, docs/guide.txt'
    );
    expect(run.result).toEqual({ released: [], unchanged: ['probe'] });
    expect(run.calls.some((c) => c.includes('/git/refs'))).toBe(false);
  });

  test('a Dependabot bump of the lock releases: package files always count', async () => {
    const { repo, records } = changedAfterTag('.', ['package-lock.json', '.github/dependabot.yml']);
    const run = await plan(repo, records);
    expect(run.lines).toContain(`${CHANGED} package-lock.json: release probe@2026.1122.1`);
  });

  test('.release-ignore adds patterns, but never over src/** or Dockerfile*', async () => {
    const ignore = '# local notes\n\nnotes.txt\nsrc/**\nDockerfile*\n';
    const files = ['notes.txt', 'src/a.ts', 'Dockerfile'];
    const { repo, records } = changedAfterTag('.', files, ignore);
    const run = await plan(repo, records);
    expect(run.lines).toContain(`${CHANGED} Dockerfile, src/a.ts: release probe@2026.1122.1`);
    const only = changedAfterTag('.', ['notes.txt'], ignore);
    const quiet = await plan(only.repo, only.records);
    expect(quiet.lines).toContain(
      'PASS unchanged: probe (.) is the same as probe@2026.1121.1; only ignored files changed: notes.txt'
    );
  });

  test('a !pattern line re-includes a default', async () => {
    const { repo, records } = changedAfterTag('.', ['README.md'], '!README.md\n');
    const run = await plan(repo, records);
    expect(run.lines).toContain(`${CHANGED} README.md: release probe@2026.1122.1`);
  });

  test('more than five files: the first five, then how many more', async () => {
    const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js', 'h.md'];
    const { repo, records } = changedAfterTag('.', files);
    const run = await plan(repo, records);
    expect(run.lines).toContain(
      `${CHANGED} a.js, b.js, c.js, d.js, e.js and 2 more: release probe@2026.1122.1`
    );
  });

  test('extensions/<name>: patterns read the folder; a markdown-only change stays', async () => {
    const repo = makeRepo();
    writeExtension(repo, 'extensions/probe', 'probe');
    writeExtension(repo, 'extensions/fixture', 'fixture');
    const first = repo.commit('two');
    repo.tag('probe@2026.1121.1');
    repo.tag('fixture@2026.1121.1');
    repo.write('extensions/probe/docs/guide.md', 'docs\n');
    repo.write('extensions/probe/index.js', 'code\n');
    repo.write('extensions/fixture/CHANGELOG.md', 'notes\n');
    repo.commit('change');
    const run = await plan(repo, { 'probe@2026.1121.1': first, 'fixture@2026.1121.1': first });
    expect(run.lines).toContain(
      'PASS changed: probe (extensions/probe) differs from probe@2026.1121.1 in index.js: release probe@2026.1122.1'
    );
    expect(run.lines).toContain(
      'PASS unchanged: fixture (extensions/fixture) is the same as fixture@2026.1121.1; only ignored files changed: CHANGELOG.md'
    );
  });

  test('a move from src/ to docs/ still releases: renames are two paths', async () => {
    const repo = makeRepo();
    writeExtension(repo, '.', 'probe');
    repo.write('src/long-enough.ts', 'export const a = 1;\n'.repeat(20));
    const first = repo.commit('base');
    repo.tag('probe@2026.1121.1');
    repo.write('docs/keep.txt', 'a folder to move into\n');
    repo.commit('docs');
    repo.git('mv', 'src/long-enough.ts', 'docs/long-enough.md');
    repo.commit('move');
    expect(repo.git('diff', '-M', '--name-status', 'HEAD~1', 'HEAD')).toMatch(/^R/);
    const run = await plan(repo, { 'probe@2026.1121.1': first });
    expect(run.lines).toContain(`${CHANGED} src/long-enough.ts: release probe@2026.1122.1`);
  });

  test('only ignored files, but the last tag has no record: released with a new N', async () => {
    const { repo } = changedAfterTag('.', ['README.md']);
    const run = await plan(repo, {});
    expect(run.lines).toContain(
      'PASS changed: probe (.) equals probe@2026.1121.1, which has no record: release probe@2026.1122.1'
    );
  });
});
