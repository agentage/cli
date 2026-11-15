import { describe, expect, vi } from 'vitest';
import { CliError, WithMeta } from '../../lib/json-output.js';
import { type Listing, type Market } from '../../lib/net/market.js';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { runList, runUpdate, table } from './lifecycle-list.js';

const NO_MARKET = new CliError('no_market', 'agentage.io has no extension market');

const market = (latest: Record<string, string>, down = false): Market => ({
  latest: vi.fn(async (id: string) => (latest[id] ? { version: latest[id], package: null } : null)),
  down: () => (down ? NO_MARKET : null),
});

const listDeps = (rows = [marketRow('probe', '0.6.2')], latest: Record<string, string> = {}) => {
  const fake = fakeHost(rows);
  const listing: Listing = { offered: [{ id: 'notes', version: '1.2.0' }], skipped: [] };
  const available = vi.fn(async () => listing);
  return { ...fake, deps: { ...fake.deps, available, market: () => market(latest) } };
};

describe('extension list', () => {
  test('the daemon rows as a table; a folder says folder and keeps its path', async () => {
    const demo = { ...marketRow('demo', '0.1.0'), source: '/work/extension-demo' };
    const failed = { ...marketRow('notes', '1.0.0'), state: 'failed', error: 'boom' };
    const { deps } = listDeps([marketRow('probe', '0.7.0'), demo, failed]);
    let rows: unknown;
    const run = await output(async () => (rows = await runList({}, deps)));
    expect(run.lines).toEqual([
      'ID     VERSION  SOURCE  STATE',
      'probe  0.7.0    market  running',
      'demo   0.1.0    folder  running',
      'notes  1.0.0    market  failed   boom',
    ]);
    expect(rows).toContainEqual({ ...demo, source: 'folder', path: '/work/extension-demo' });
    expect(rows).toContainEqual(marketRow('probe', '0.7.0'));
  });

  test('no extensions says so', async () => {
    const { deps } = listDeps([]);
    expect((await output(() => runList({}, deps))).lines).toEqual(['no extensions']);
  });

  test('--available reads the market, not the daemon; a silent market fails', async () => {
    const { deps, host } = listDeps();
    const run = await output(() => runList({ available: true }, deps));
    expect(run.lines).toEqual(['ID     VERSION', 'notes  1.2.0']);
    expect(host.list).not.toHaveBeenCalled();
    deps.available.mockRejectedValueOnce(NO_MARKET);
    const down = await output(() => runList({ available: true }, deps));
    expect(down).toMatchObject({ code: 'no_market', error: NO_MARKET.message });
    deps.available.mockResolvedValueOnce({ offered: [], skipped: [] });
    expect((await output(() => runList({ available: true }, deps))).lines).toEqual([
      'the market lists nothing',
    ]);
  });

  test('--available lists the rows it could read; the skipped ones go to stderr and meta', async () => {
    const { deps } = listDeps();
    const skipped = [{ id: 'bad', reason: 'https://m/api/v1/extensions/bad/latest answered 503' }];
    deps.available.mockResolvedValueOnce({ offered: [{ id: 'notes', version: '1.2.0' }], skipped });
    let got: unknown;
    const run = await output(async () => (got = await runList({ available: true }, deps)));
    expect(run.code).toBeNull();
    expect(run.lines).toEqual(['ID     VERSION', 'notes  1.2.0']);
    expect(run.stderr).toBe(`skipped bad (${skipped[0]?.reason})`);
    expect(got).toEqual(new WithMeta([{ id: 'notes', version: '1.2.0' }], { skipped }));
  });

  test('table pads every column but the last', () => {
    expect(
      table([
        ['a', 'bb'],
        ['ccc', 'd'],
      ])
    ).toEqual(['a    bb', 'ccc  d']);
  });
});

describe('extension update', () => {
  const rows = () => [
    marketRow('probe', '0.6.2'),
    marketRow('notes', '1.0.0'),
    { ...marketRow('demo', '0.1.0'), source: '/work/demo' },
  ];

  test('each market extension moves to the newest version; folders are left alone', async () => {
    const { deps, host } = listDeps(rows(), { probe: '0.8.0', notes: '1.0.0', demo: '9.0.0' });
    let moved: unknown;
    const run = await output(async () => (moved = await runUpdate({}, deps)));
    expect(vi.mocked(host.change).mock.calls).toEqual([['probe', { version: '0.8.0' }]]);
    expect(run.lines).toEqual(['probe 0.6.2 to 0.8.0']);
    expect(moved).toEqual([{ id: 'probe', from: '0.6.2', to: '0.8.0', updated: true }]);
  });

  test('update deletes the folder of the version it left; a refused change keeps it', async ({
    dir,
  }) => {
    for (const tree of ['probe@0.6.2', 'probe@0.8.0'])
      dir.write(`extensions/packages/trees/${tree}/.complete`, '');
    dir.write('installation.json', {
      host: 'local',
      extensions: [{ id: 'probe', version: '0.8.0' }],
    });
    const refused = listDeps([marketRow('probe', '0.6.2')], { probe: '0.8.0' });
    vi.mocked(refused.host.change).mockRejectedValueOnce(new Error('START_FAILED'));
    await output(() => runUpdate({}, refused.deps));
    expect(dir.list('extensions/packages/trees')).toEqual(['probe@0.6.2', 'probe@0.8.0']);
    const { deps } = listDeps([marketRow('probe', '0.6.2')], { probe: '0.8.0' });
    await output(() => runUpdate({}, deps));
    expect(dir.list('extensions/packages/trees')).toEqual(['probe@0.8.0']);
  });

  test('update <id> changes only that one; --check changes nothing', async () => {
    const { deps, host } = listDeps(rows(), { probe: '0.8.0', notes: '1.1.0' });
    await output(() => runUpdate({ id: 'notes' }, deps));
    expect(vi.mocked(host.change).mock.calls).toEqual([['notes', { version: '1.1.0' }]]);
    const check = await output(() => runUpdate({ check: true }, deps));
    expect(check.lines).toEqual(['probe 0.6.2 to 0.8.0 (available)']);
    expect(host.change).toHaveBeenCalledOnce();
  });

  test('nothing newer says so; an id not from the market, or a silent market, fails', async () => {
    const { deps } = listDeps(rows(), {});
    expect((await output(() => runUpdate({}, deps))).lines).toEqual([
      'every extension is at its newest version',
    ]);
    expect((await output(() => runUpdate({ id: 'demo' }, deps))).code).toBe('not_installed');
    const down = { ...deps, market: () => market({}, true) };
    expect(await output(() => runUpdate({}, down))).toMatchObject({
      code: 'no_market',
      error: NO_MARKET.message,
    });
  });
});
