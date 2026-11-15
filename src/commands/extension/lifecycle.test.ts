import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { runEnabled, runInstall, runRemove, specOf, type ConfirmIo } from './lifecycle.js';

const noTerminal: ConfirmIo = { isTTY: false, prompt: vi.fn(async () => 'y') };

describe('extension install', () => {
  test('an id, id@version or a package name of the id', () => {
    expect(specOf('probe')).toEqual({ id: 'probe' });
    expect(specOf('probe@0.6.2')).toEqual({ id: 'probe', version: '0.6.2' });
    expect(specOf('@agentage/extension-probe@1')).toEqual({ id: 'probe', version: '1' });
    expect(() => specOf('Probe')).toThrow('not an id, id@version or a folder');
    expect(() => specOf('probe@')).toThrow('not an id');
    expect(() => specOf('@other/thing')).toThrow(/only @agentage\/extension-<id> packages install/);
    expect(() => specOf('https://x.test/a.tgz')).toThrow(
      /unpack it, then agentage extension install/
    );
  });

  test('a new id is a POST; the extension runs', async () => {
    const { host, deps } = fakeHost();
    const run = await output(() => runInstall({ name: 'probe' }, deps));
    expect(host.add).toHaveBeenCalledWith({ id: 'probe' });
    expect(run.lines).toEqual(['probe 0.7.0 running']);
  });

  test('installed: another version is a PATCH (go back keeps the data); the same is no change', async () => {
    const { host, deps } = fakeHost([marketRow('probe', '0.7.0')]);
    await output(() => runInstall({ name: 'probe@0.6.2' }, deps));
    expect(host.change).toHaveBeenCalledWith('probe', { version: '0.6.2' });
    await output(() => runInstall({ name: 'probe@0.6.2' }, deps));
    await output(() => runInstall({ name: 'probe' }, deps));
    expect(host.change).toHaveBeenCalledOnce();
    expect(host.add).not.toHaveBeenCalled();
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
