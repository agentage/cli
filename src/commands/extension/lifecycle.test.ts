import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { DaemonError, writeError } from '../../lib/json-output.js';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { specOf } from './install-spec.js';
import { runEnabled, runInstall, runRemove, type ConfirmIo } from './lifecycle.js';

const noTerminal: ConfirmIo = { isTTY: false, prompt: vi.fn(async () => 'y') };

describe('extension install', () => {
  test('an id, id@version or a package name of the id', () => {
    expect(specOf('probe')).toEqual({ id: 'probe' });
    expect(specOf('probe@0.6.2')).toEqual({ id: 'probe', version: '0.6.2' });
    expect(specOf('@agentage/extension-probe@1')).toEqual({ id: 'probe', version: '1' });
    expect(() => specOf('Probe')).toThrow('not an id, id@version or a folder');
    expect(() => specOf('probe@')).toThrow('not an id');
    expect(() => specOf('sync')).toThrow('sync: the id sync is a name the platform owns');
    expect(() => specOf('@other/thing')).toThrow(/only @agentage\/extension-<id> packages install/);
    expect(() => specOf('https://x.test/a.tgz')).toThrow(
      /unpack it, then agentage extension install/
    );
  });

  test('after @ only a version, a range or a dist-tag: a path, file:, git+, a URL, a space or a flag is refused', () => {
    expect(specOf('probe@broken')).toEqual({ id: 'probe', version: 'broken' });
    expect(specOf('probe@http')).toEqual({ id: 'probe', version: 'http' });
    for (const bad of [
      '../x',
      'file:../x',
      'git+ssh://h/r.git',
      'http://h/x',
      'a b',
      '--registry=x',
    ])
      expect(() => specOf(`probe@${bad}`), bad).toThrow(
        expect.objectContaining({
          code: 'invalid_argument',
          message: expect.stringMatching(/after @ only/),
        })
      );
  });

  test('a bad install string is refused before the daemon starts', async () => {
    const host = vi.fn(async () => {
      throw new Error('the daemon started');
    });
    for (const name of ['probe@../x', 'Probe', './nope'])
      expect((await output(() => runInstall({ name }, { host }))).error, name).not.toMatch(
        /the daemon started/
      );
    expect(host).not.toHaveBeenCalled();
  });

  test('a new id is a POST; the extension runs', async () => {
    const { host, deps } = fakeHost();
    const run = await output(() => runInstall({ name: 'probe' }, deps));
    expect(host.add).toHaveBeenCalledWith({ id: 'probe' });
    expect(run.lines).toEqual(['probe 0.7.0 running']);
  });

  test('a site with no market: a bare id says it came from npm on stderr; id@version does not', async () => {
    const { deps } = fakeHost();
    const line = 'agentage.io has no extension market; probe 0.7.0 came from npm, as cli 0.51 did';
    const fromNpm = vi.fn(async () => line);
    const run = await output(() => runInstall({ name: 'probe' }, { ...deps, fromNpm }));
    expect(run.lines).toEqual(['probe 0.7.0 running']);
    expect(run.stderr).toBe(
      'agentage.io has no extension market; probe 0.7.0 came from npm, as cli 0.51 did'
    );
    const pinned = await output(() => runInstall({ name: 'probe@0.7.0' }, { ...deps, fromNpm }));
    expect(pinned.stderr).toBe('');
    expect(fromNpm).toHaveBeenCalledExactlyOnceWith('probe', 'probe 0.7.0 came');
  });

  test('below the Node floor: install prints the seal-off reason on one line, never refuses', async () => {
    const { deps } = fakeHost();
    const reason = 'seal off: Node 22.22.2 or 24.14.1 needed, this is Node 24.6.0';
    const run = await output(() =>
      runInstall({ name: 'probe' }, { ...deps, sealOff: async () => reason })
    );
    expect(run.lines).toEqual(['probe 0.7.0 running']);
    expect(run.stderr).toBe(reason);
    expect(run.error).toBeNull();
  });

  test('START_FAILED as the daemon gives it: the message, exit 1, the details in the --json envelope', async () => {
    const { host, deps } = fakeHost();
    const details = { code: 'START_FAILED', reason: 'broken on purpose' };
    const refused = new DaemonError(
      'VALIDATION_ERROR',
      'fixture failed to start: broken on purpose',
      400,
      details
    );
    vi.mocked(host.add).mockRejectedValueOnce(refused);
    const run = await output(() => runInstall({ name: 'fixture@broken' }, deps));
    expect(host.add).toHaveBeenCalledWith({ id: 'fixture', version: 'broken' });
    expect(run).toMatchObject({
      code: 'VALIDATION_ERROR',
      error: 'fixture failed to start: broken on purpose',
    });
    const out: string[] = [];
    writeError({ writeOut: (t) => void out.push(t) }, refused);
    expect(JSON.parse(out.join(''))).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'fixture failed to start: broken on purpose',
        details,
      },
    });
  });

  test('an unscoped npm name: refused before npm when the site has a market', async () => {
    const { host, deps } = fakeHost();
    const name = 'agentage-extension-probe';
    const market = { ...deps, hasMarket: vi.fn(async () => true) };
    expect(await output(() => runInstall({ name }, market))).toMatchObject({
      code: 'invalid_argument',
      error: `${name}: an unscoped npm name installs only on a site with no market; nothing installed; install its folder instead: agentage extension install ./<folder>`,
    });
    expect(host.add).not.toHaveBeenCalled();
    await output(() => runInstall({ name }, { ...deps, hasMarket: vi.fn(async () => false) }));
    expect(host.add).toHaveBeenCalledWith({ id: 'probe' });
  });

  test('installed: another version is a PATCH (go back keeps the data); the same is no change', async () => {
    const { host, deps } = fakeHost([marketRow('probe', '0.7.0')]);
    await output(() => runInstall({ name: 'probe@0.6.2' }, deps));
    expect(host.change).toHaveBeenCalledWith('probe', { version: '0.6.2' });
    const same = await output(() => runInstall({ name: 'probe@0.6.2' }, deps));
    const bare = await output(() => runInstall({ name: 'probe' }, deps));
    expect(host.change).toHaveBeenCalledOnce();
    expect([same.lines, bare.lines]).toEqual([
      ['probe 0.6.2 running (already installed)'],
      ['probe 0.6.2 running (already installed)'],
    ]);
  });

  test('two installs at once: the daemon adds one, the other is told it is installed', async () => {
    const { host, deps } = fakeHost();
    const run = await output(() =>
      Promise.all([runInstall({ name: 'probe' }, deps), runInstall({ name: 'probe' }, deps)])
    );
    expect(run.lines).toEqual(['probe 0.7.0 running', 'probe 0.7.0 running (already installed)']);
    expect(host.add).toHaveBeenCalledTimes(2);
    expect(host.list).toHaveBeenCalledOnce();
  });

  test('an id the daemon runs from a folder, or a folder of an id from elsewhere, is refused', async () => {
    const demo = { ...marketRow('demo', '0.1.0'), source: '/work/extension-demo' };
    const { deps } = fakeHost([demo]);
    expect(await output(() => runInstall({ name: 'demo' }, deps))).toMatchObject({
      code: 'already_installed',
      error: 'demo runs from the folder /work/extension-demo; agentage extension remove demo first',
    });
    // The id comes from the 409 details (kit 0.14), not from the folder's package.json.
    const dir = mkdtempSync(join(tmpdir(), 'agentage-demo-'));
    expect(await output(() => runInstall({ name: dir }, deps))).toMatchObject({
      code: 'already_installed',
      error:
        'demo is installed from the folder /work/extension-demo; agentage extension remove demo first',
    });
    const market = fakeHost([marketRow('demo', '0.1.0')]);
    expect(await output(() => runInstall({ name: dir }, market.deps))).toMatchObject({
      error: 'demo is installed from the market; agentage extension remove demo first',
    });
  });

  test('the same folder again is installed already', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agentage-demo-')));
    const { deps } = fakeHost([{ ...marketRow('demo', '0.1.0'), source: dir }]);
    expect((await output(() => runInstall({ name: dir }, deps))).lines).toEqual([
      'demo 0.1.0 running (already installed)',
    ]);
  });

  test('the same folder through a link, stored with a trailing slash, is installed already', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agentage-demo-')));
    const link = `${dir}-link`;
    symlinkSync(dir, link);
    const { deps } = fakeHost([{ ...marketRow('demo', '0.1.0'), source: `${link}/` }]);
    expect((await output(() => runInstall({ name: dir }, deps))).lines).toEqual([
      'demo 0.1.0 running (already installed)',
    ]);
    unlinkSync(link);
  });

  test('a folder goes by its real path; one another user can write is refused', async () => {
    const { host, deps } = fakeHost();
    const dir = mkdtempSync(join(tmpdir(), 'agentage-demo-'));
    await output(() => runInstall({ name: dir }, deps));
    expect(host.add).toHaveBeenCalledWith({ source: realpathSync(dir) });
    chmodSync(dir, 0o777);
    const unsafe = await output(() => runInstall({ name: dir }, deps));
    expect(unsafe.error).toMatch(/world-writable/);
    expect((await output(() => runInstall({ name: './nope' }, deps))).error).toBe(
      './nope: no such folder'
    );
  });

  test('--off installs, then disables, and names the new command', async () => {
    const { host, deps } = fakeHost();
    const run = await output(() => runInstall({ name: 'probe', off: true }, deps));
    expect(host.change).toHaveBeenCalledWith('probe', { enabled: false });
    expect(run.stderr).toBe('install --off is now: agentage extension disable <id>');
    expect(run.lines).toEqual(['probe 0.7.0 disabled']);
  });

  test('a failed start exits 1 with the reason', async () => {
    const { deps, host } = fakeHost();
    vi.mocked(host.add).mockResolvedValueOnce({
      id: 'probe',
      version: '0.7.0',
      state: 'failed',
      error: 'boom',
    });
    const run = await output(() => runInstall({ name: 'probe' }, deps));
    expect(run).toMatchObject({ error: 'probe failed: boom', code: 'extension_failed' });
  });
});

describe('extension disable, enable and remove', () => {
  test('disable and enable change enabled', async () => {
    const { host, deps } = fakeHost([marketRow('probe', '0.7.0')]);
    expect((await output(() => runEnabled('probe', false, deps))).lines).toEqual([
      'probe 0.7.0 disabled',
    ]);
    await output(() => runEnabled('probe', true, deps));
    expect(vi.mocked(host.change).mock.calls).toEqual([
      ['probe', { enabled: false }],
      ['probe', { enabled: true }],
    ]);
    const nope = await output(() => runEnabled('nope', false, deps));
    expect(nope).toMatchObject({ code: 'NOT_FOUND', error: 'nope is not installed' });
  });

  test('remove keeps the data; --purge deletes it, and without a terminal needs --yes', async () => {
    const { host, deps } = fakeHost([marketRow('probe', '0.7.0'), marketRow('notes', '1.0.0')]);
    const kept = await output(() => runRemove({ name: 'probe' }, { ...deps, io: noTerminal }));
    expect(kept.lines).toEqual(['removed probe']);
    const refused = await output(() =>
      runRemove({ name: 'notes', purge: true }, { ...deps, io: noTerminal })
    );
    expect(refused.code).toBe('confirmation_required');
    await output(() =>
      runRemove({ name: 'notes', purge: true, yes: true }, { ...deps, io: noTerminal })
    );
    expect(vi.mocked(host.remove).mock.calls).toEqual([
      ['probe', false],
      ['notes', true],
    ]);
  });

  test('--purge on a terminal asks; no keeps everything', async () => {
    const { host, deps } = fakeHost([marketRow('probe', '0.7.0')]);
    const io: ConfirmIo = { isTTY: true, prompt: vi.fn(async () => 'n') };
    const run = await output(() => runRemove({ name: 'probe', purge: true }, { ...deps, io }));
    expect(run.error).toBe('nothing removed');
    expect(host.remove).not.toHaveBeenCalled();
    io.prompt = vi.fn(async () => 'yes');
    const yes = await output(() => runRemove({ name: 'probe', purge: true }, { ...deps, io }));
    expect(yes.lines).toEqual(['removed probe, its data deleted']);
  });

  test('remove refuses an extension another installed one depends on, unless --force', async ({
    dir,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'agentage-peers-'));
    const base = writeKitExtension(join(root, 'base'), 'base', '1.0.0');
    const user = writeKitExtension(join(root, 'user'), 'user', '1.0.0');
    const manifest = JSON.parse(readFileSync(join(user, 'package.json'), 'utf8'));
    manifest.peerDependencies = { '@agentage/extension-base': '^1' };
    writeFileSync(join(user, 'package.json'), JSON.stringify(manifest));
    // A disabled dependent counts too.
    const rows = [
      { id: 'base', source: base },
      { id: 'user', source: user, enabled: false },
    ];
    dir.write('installation.json', { host: 'local', extensions: rows });
    const { host, deps } = fakeHost([marketRow('base', '1.0.0'), marketRow('user', '1.0.0')]);
    const refused = await output(() => runRemove({ name: 'base' }, { ...deps, io: noTerminal }));
    expect(refused).toMatchObject({
      code: 'needed_by_dependents',
      error: 'base is needed by user; remove them first, or --force',
    });
    expect(host.remove).not.toHaveBeenCalled();
    await output(() => runRemove({ name: 'base', force: true }, { ...deps, io: noTerminal }));
    expect(host.remove).toHaveBeenCalledWith('base', false);
  });

  test('remove deletes the version folders no entry uses, never the 0.51 tree', async ({ dir }) => {
    for (const tree of ['probe@0.6.2', 'probe@0.7.0', 'notes@1.0.0'])
      dir.write(`extensions/packages/trees/${tree}/.complete`, '');
    dir.write('extensions/trees/old/node_modules/@agentage/extension-probe/package.json', {});
    // As the daemon leaves it after DELETE: probe is gone, notes stays.
    dir.write('installation.json', {
      host: 'local',
      extensions: [{ id: 'notes', version: '1.0.0' }],
    });
    const { deps } = fakeHost([marketRow('probe', '0.7.0'), marketRow('notes', '1.0.0')]);
    await output(() => runRemove({ name: 'probe' }, { ...deps, io: noTerminal }));
    expect(dir.list('extensions/packages/trees')).toEqual(['notes@1.0.0']);
    expect(dir.exists('extensions/trees/old/node_modules/@agentage/extension-probe')).toBe(true);
  });
});
