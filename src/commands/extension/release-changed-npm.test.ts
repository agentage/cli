import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import {
  ciClone,
  makeRepo,
  pkgOf,
  release,
  REPO,
  writeExtension,
  type World,
} from '../../test/release-repo.js';

const VISIBILITY = `gh api repos/${REPO} --jq .private`;

// One public-npm extension (no "private": true) at the root, with extra package.json fields.
const publicPackage = (extra: Record<string, unknown> = {}) => {
  const repo = makeRepo();
  repo.write('package.json', `${JSON.stringify({ ...pkgOf('probe'), ...extra }, null, 2)}\n`);
  repo.write('index.js', 'export {};\n');
  repo.commit('one');
  return ciClone(repo);
};

const npmCalls = (calls: string[]) => calls.filter((c) => c.startsWith('npm'));

const skipped = async (w: World, extra?: Record<string, unknown>) => {
  const run = await release({ dir: publicPackage(extra), w });
  expect(run.error).toBeNull();
  expect(npmCalls(run.calls)).toEqual([]);
  expect(run.calls.filter((c) => c.startsWith('gh release create'))).toHaveLength(1);
  expect(run.lines.slice(-2)).toEqual([
    'id     version      result',
    'probe  2026.1122.1  released, AMBER: npm skipped',
  ]);
  expect(run.result).toMatchObject({ released: [{ published: false, built: true }] });
  return run.lines.filter((l) => l.startsWith('AMBER'));
};

describe('extension release --changed: npm from a private repo', () => {
  test('a public repo publishes as before', async () => {
    const run = await release({ dir: publicPackage() });
    expect(run.calls).toContain(VISIBILITY);
    expect(run.calls).toContain('npm publish --access public --provenance --ignore-scripts');
  });

  test('a private repo: npm is skipped with one AMBER line; images and record go out', async () => {
    expect(await skipped({ visibility: 'true' })).toEqual([
      `AMBER npm: ${REPO} is a private repo: npm skipped; set publishConfig.access to "public" and agentagePublishFromPrivateRepo to true to publish it`,
    ]);
  });

  test('half an opt-in is no opt-in', async () => {
    const only = { publishConfig: { access: 'public' } };
    expect(await skipped({ visibility: 'true' }, only)).toHaveLength(1);
    expect(
      await skipped({ visibility: 'true' }, { agentagePublishFromPrivateRepo: true })
    ).toHaveLength(1);
  });

  test('both opt-in fields publish from a private repo', async () => {
    const extra = { publishConfig: { access: 'public' }, agentagePublishFromPrivateRepo: true };
    const run = await release({ dir: publicPackage(extra), w: { visibility: 'true' } });
    expect(run.error).toBeNull();
    expect(run.lines).toContain(
      `PASS npm: ${REPO} is private, @agentage/extension-probe opts in to public npm`
    );
    expect(run.calls).toContain('npm publish --access public --provenance --ignore-scripts');
  });

  test('a visibility that cannot be read fails that extension before its tag: exit 1', async () => {
    const cases: [World['visibility'], string][] = [
      [{ ok: false, out: '', err: 'HTTP 502' }, 'HTTP 502'],
      ['', 'no answer'],
      ['null', 'null'],
    ];
    for (const [visibility, why] of cases) {
      const run = await release({ dir: publicPackage(), w: { visibility } });
      expect(run.code).toBe('release_refused');
      expect(run.error).toBe(`probe: FAIL npm: cannot read whether ${REPO} is private (${why})`);
      expect(run.calls.filter((c) => c.includes('/git/refs') || c.startsWith('npm'))).toEqual([]);
      expect(run.lines.at(-1)).toBe('probe  2026.1122.1  failed');
    }
  });

  test('a "private": true package never reads the visibility', async () => {
    const repo = makeRepo();
    writeExtension(repo, '.', 'probe', { private: true });
    repo.commit('one');
    const run = await release({ dir: ciClone(repo), w: { visibility: 'true' } });
    expect(run.error).toBeNull();
    expect(run.calls).not.toContain(VISIBILITY);
    expect(run.lines).not.toContain(expect.stringMatching(/^AMBER/));
  });
});
