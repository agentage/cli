import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { checkoutAt, ciClone, makeRepo, release, writeExtension } from '../../test/release-repo.js';

const tagged = (calls: string[]) => calls.filter((c) => c.includes('/git/refs'));

// probe changed on C1 (its run failed), then changed again and released on C2.
const oldAndNew = () => {
  const repo = makeRepo();
  writeExtension(repo, 'extensions/probe', 'probe');
  repo.commit('base');
  repo.tag('probe@2026.1121.1');
  const base = repo.git('rev-parse', 'HEAD');
  repo.write('extensions/probe/index.js', 'c1\n');
  writeExtension(repo, 'extensions/fixture', 'fixture');
  const c1 = repo.commit('c1');
  repo.write('extensions/probe/index.js', 'c2\n');
  const c2 = repo.commit('c2');
  repo.tag('probe@2026.1122.1');
  return { repo, c1, records: { 'probe@2026.1121.1': base, 'probe@2026.1122.1': c2 } };
};

// probe tagged `count` times today with no record, then changed again.
const failedTags = (count: number) => {
  const repo = makeRepo();
  writeExtension(repo, 'extensions/probe', 'probe');
  repo.commit('base');
  for (let n = 1; n <= count; n++) {
    repo.tag(`probe@2026.1122.${n}`);
    repo.write('extensions/probe/index.js', `try ${n}\n`);
    repo.commit(`try ${n}`);
  }
  return repo;
};

describe('extension release --changed: an older commit', () => {
  test('a re-run of an older commit is refused for an id tagged later; others still go', async () => {
    const { repo, c1, records } = oldAndNew();
    const run = await release({ dir: checkoutAt(repo, c1), w: { records } });
    expect(run.code).toBe('release_refused');
    expect(run.error).toMatch(
      /^probe: FAIL history: probe@2026\.1122\.1 is on \w{40}, which is not/
    );
    expect(run.error).toContain(`not before ${c1}: an older commit is refused`);
    expect(tagged(run.calls)).toEqual([
      `gh api repos/agentage/examples/git/refs -f ref=refs/tags/fixture@2026.1122.1 -f sha=${c1}`,
    ]);
    expect(run.lines.slice(-3)).toEqual([
      'id       version      result',
      'probe    -            refused',
      'fixture  2026.1122.1  released',
    ]);
  });
});

describe('extension release --changed: tags with no record', () => {
  test('three in a row with no record: refused, the three named, no new tag', async () => {
    const run = await release({ dir: ciClone(failedTags(3)), opts: { dryRun: true } });
    expect(run.error).toBe(
      'probe: FAIL stuck: probe@2026.1122.3, probe@2026.1122.2, probe@2026.1122.1 have no record: fix the release, or remove those tags'
    );
    expect(run.lines).toContain('probe  -        refused');
  });

  test('two with no record: still released with the next N', async () => {
    const run = await release({ dir: ciClone(failedTags(2)), opts: { dryRun: true } });
    expect(run.error).toBeNull();
    expect(run.lines).toContain(
      'PASS changed: probe (extensions/probe) differs from probe@2026.1122.2: release probe@2026.1122.3'
    );
  });

  test('a record on the newest tag breaks the row: one record check only', async () => {
    const repo = failedTags(3);
    const records = { 'probe@2026.1122.3': repo.git('rev-list', '-n', '1', 'probe@2026.1122.3') };
    const run = await release({ dir: ciClone(repo), w: { records }, opts: { dryRun: true } });
    expect(run.error).toBeNull();
    expect(run.calls.filter((c) => c.startsWith('gh release download'))).toHaveLength(1);
  });
});

describe('extension release --changed: npm and the record', () => {
  test('npm fails: no record goes up, so the next commit releases a new N', async () => {
    const repo = makeRepo();
    writeExtension(repo, 'extensions/probe', 'probe');
    repo.commit('one');
    const run = await release({ dir: ciClone(repo), w: { npmFails: 'E403 forbidden' } });
    expect(run.error).toBe('probe: FAIL npm: E403 forbidden');
    expect(run.calls).toContain('build probe@2026.1122.1');
    expect(run.calls.some((c) => c.startsWith('gh release create'))).toBe(false);
    repo.tag('probe@2026.1122.1');
    repo.write('README.md', 'outside the folder\n');
    repo.commit('readme');
    const next = await release({ dir: ciClone(repo), opts: { dryRun: true } });
    expect(next.lines).toContain(
      'PASS changed: probe (extensions/probe) equals probe@2026.1122.1, which has no record: release probe@2026.1122.2'
    );
  });
});

describe('extension release --changed: one failure', () => {
  test('a failed extension does not stop the next; one table, a non-zero exit', async () => {
    const repo = makeRepo();
    writeExtension(repo, 'extensions/fixture', 'fixture', { api: true });
    writeExtension(repo, 'extensions/probe', 'probe', { api: true });
    repo.commit('two');
    // A half-done contracts write leaves a file behind: it must not block the next build.
    const writeContracts = async (dir: string) => {
      writeFileSync(join(dir, 'openapi.json'), '{}\n');
      if (dir.endsWith('fixture')) throw new Error('fixture contracts broke');
      return ['openapi.json'];
    };
    const run = await release({ dir: ciClone(repo) }, { writeContracts });
    expect(run.error).toBe('fixture: FAIL contracts: fixture contracts broke');
    expect(run.calls).toContain('build probe@2026.1122.1');
    expect(run.lines.slice(-3)).toEqual([
      'id       version      result',
      'fixture  2026.1122.1  failed',
      'probe    2026.1122.1  released',
    ]);
  });
});
