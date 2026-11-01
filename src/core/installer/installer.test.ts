import { rmSync } from 'node:fs';
import { describe, expect, vi } from 'vitest';
import { npmFromFixtures, pkg, test } from '../../test/config-dir.js';
import { install, planInstall, type InstallSet } from './installer.js';
import { type Npm } from './npm.js';
import { withInstallLock } from './tree.js';

const [HELLO, WORLD] = [pkg('hello'), pkg('world')];
const ONE: InstallSet = { extensions: { [HELLO]: '^1.0.0' }, registries: {} };
const TWO: InstallSet = { extensions: { [WORLD]: '^1', [HELLO]: '^1.0.0' }, registries: {} };

const npmNeverRuns = async (): Promise<Npm> => {
  throw new Error('npm must not run');
};

// npm stand-ins for what no fixture can show: a failure with long output, a run without a lock.
const npmExits =
  (code: number, stderr = '') =>
  async (): Promise<Npm> =>
  async () => ({ code, stdout: '', stderr });

describe('installing a profile', () => {
  test('builds the tree from the profile alone: a sorted, script-free package.json and an .npmrc per scope', async ({
    dir,
  }) => {
    const registries = {
      '@agentage': 'http://127.0.0.1:4873',
      '@acme': 'https://npm.acme.example',
    };
    const result = await install({ ...TWO, registries }, npmFromFixtures);
    const tree = `extensions/trees/${result.tree}`;
    expect(result).toEqual({
      tree: dir.file('extensions/current'),
      npm: 'install',
      reused: false,
      count: 2,
    });
    expect(dir.list(tree)).toEqual([
      '.complete',
      '.npmrc',
      'node_modules',
      'package-lock.json',
      'package.json',
    ]);
    expect(dir.file(`${tree}/.npmrc`)).toBe(
      '@acme:registry=https://npm.acme.example\n@agentage:registry=http://127.0.0.1:4873'
    );
    const manifest = {
      name: 'agentage-extensions',
      private: true,
      dependencies: { [HELLO]: '^1.0.0', [WORLD]: '^1' },
    };
    expect(dir.file(`${tree}/package.json`)).toBe(JSON.stringify(manifest, null, 2));
    expect(dir.file('extensions/package.json')).toBe(dir.file(`${tree}/package.json`));
    expect(dir.file('extensions/package-lock.json')).toBe(dir.file(`${tree}/package-lock.json`));
  });

  test('with no extensions points current at an empty tree without running npm', async ({
    dir,
  }) => {
    const result = await install({ extensions: {}, registries: {} }, npmNeverRuns);
    expect(result).toMatchObject({ npm: null, count: 0 });
    expect(dir.list(`extensions/trees/${result.tree}`)).toEqual([
      '.complete',
      '.npmrc',
      'package.json',
    ]);
    expect(dir.exists('extensions/package-lock.json')).toBe(false);
  });

  test('again reuses its tree without running npm', async () => {
    const first = await install(TWO, npmFromFixtures);
    expect(await install(TWO, npmNeverRuns)).toEqual({ ...first, npm: null, reused: true });
  });

  test('whose tree is gone, but whose lock still matches, rebuilds the same tree with npm ci', async ({
    dir,
  }) => {
    const first = await install(TWO, npmFromFixtures);
    rmSync(dir.at('extensions/trees'), { recursive: true });
    expect(await install(TWO, npmFromFixtures)).toEqual({ ...first, npm: 'ci' });
  });

  test('whose tree never finished rebuilds it instead of trusting it', async ({ dir }) => {
    const first = await install(TWO, npmFromFixtures);
    rmSync(dir.at(`extensions/trees/${first.tree}/.complete`));
    dir.write(`extensions/trees/${first.tree}/half-written`, '');
    expect(await install(TWO, npmFromFixtures)).toMatchObject({ tree: first.tree, npm: 'ci' });
    expect(dir.list(`extensions/trees/${first.tree}`)).not.toContain('half-written');
  });

  test('that changed runs npm install from the old lock, so npm keeps every pin it can', async ({
    dir,
  }) => {
    await install(ONE, npmFromFixtures);
    const plan = planInstall(TWO);
    expect(plan).toMatchObject({ npm: 'install', tree: null, reuse: false });
    expect(plan.lock?.trim()).toBe(dir.file('extensions/package-lock.json'));
  });

  test('switched back to an earlier one lands on its existing tree, not a copy', async ({
    dir,
  }) => {
    const one = await install(ONE, npmFromFixtures);
    await install(TWO, npmFromFixtures);
    expect(await install(ONE, npmFromFixtures)).toMatchObject({ tree: one.tree, npm: 'install' });
    expect(dir.list('extensions/trees')).toHaveLength(2);
    expect(dir.file('extensions/current')).toBe(one.tree);
  });

  test("that npm fails keeps current and the last good tree, quoting npm's last 20 lines", async ({
    dir,
  }) => {
    const good = await install(ONE, npmFromFixtures);
    const lines = Array.from({ length: 30 }, (_, i) => `npm error line ${i}`);
    const failed = await install(TWO, npmExits(1, lines.join('\n\n'))).catch(
      (e: Error) => e.message
    );
    expect(failed).toBe(
      ['npm install failed (exit 1); extensions/current is unchanged', ...lines.slice(10)].join(
        '\n'
      )
    );
    expect(dir.file('extensions/current')).toBe(good.tree);
    expect(dir.list('extensions/trees')).toEqual([good.tree]);
    expect(dir.json('extensions/package.json')).toMatchObject({ dependencies: ONE.extensions });
  });

  test('that npm leaves without a lock fails and installs nothing', async ({ dir }) => {
    await expect(install(TWO, npmExits(0))).rejects.toThrow(
      'npm install wrote no usable package-lock.json'
    );
    expect(dir.exists('extensions/current')).toBe(false);
    expect(dir.list('extensions/trees')).toEqual([]);
  });

  test('clears a staging dir a crashed run left behind', async ({ dir }) => {
    dir.write('extensions/trees/.staging-crashed/package.json', '{}');
    const result = await install(TWO, npmFromFixtures);
    expect(dir.list('extensions/trees')).toEqual([result.tree]);
  });

  test('goes to AGENTAGE_EXTENSIONS_DIR when it is set', async ({ dir }) => {
    process.env['AGENTAGE_EXTENSIONS_DIR'] = dir.at('elsewhere');
    const result = await install(TWO, npmFromFixtures);
    expect(dir.file('elsewhere/current')).toBe(result.tree);
    expect(dir.exists('extensions')).toBe(false);
  });

  test('that runs for minutes keeps install.lock fresh, so no waiting run takes it over', async ({
    dir,
  }) => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const stamp = (): string => dir.file('extensions/install.lock');
      const stamps = await withInstallLock(dir.at('extensions'), async () => {
        const first = stamp();
        await vi.advanceTimersByTimeAsync(20_000);
        return [first, stamp()];
      });
      expect(stamps).toEqual([`${process.pid} 1000`, `${process.pid} 21000`]);
      expect(dir.exists('extensions/install.lock')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
