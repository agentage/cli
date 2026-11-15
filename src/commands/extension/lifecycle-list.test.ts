import { describe, expect, vi } from 'vitest';
import { type Market } from '../../lib/net/market.js';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { runList, runUpdate, table } from './lifecycle-list.js';

const market = (latest: Record<string, string>, down = false): Market => ({
  latest: vi.fn(async (id: string) => (latest[id] ? { version: latest[id], package: null } : null)),
  down: () => down,
});

const listDeps = (rows = [marketRow('probe', '0.6.2')], latest: Record<string, string> = {}) => {
  const fake = fakeHost(rows);
  const available = vi.fn(async () => [{ id: 'notes', version: '1.2.0' }]);
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
    deps.available.mockRejectedValueOnce(new Error('no market'));
    const down = await output(() => runList({ available: true }, deps));
    expect(down).toMatchObject({ code: 'market_unavailable' });
    deps.available.mockResolvedValueOnce([]);
    expect((await output(() => runList({ available: true }, deps))).lines).toEqual([
      'the market lists nothing',
    ]);
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
    expect((await output(() => runUpdate({}, down))).code).toBe('market_unavailable');
  });
});
