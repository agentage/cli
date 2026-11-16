import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, vi } from 'vitest';
import { type Profile } from '../../core/profile/schema.js';
import { hostClient } from '../../lib/daemon/host-client.js';
import { output, test, type ConfigDir } from '../../test/config-dir.js';
import { writeKitExtension } from '../../test/kit-fixture.js';
import { cliInstaller } from '../daemon/installer.js';
import { runDaemon } from '../daemon/run.js';
import { installThroughDaemon } from './setup-install.js';
import { CliError } from '../../lib/json-output.js';

const OFFLINE = new CliError('market_unreachable', 'cannot reach the market: offline');

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
};

// A finished per-version tree, as the installer leaves it: no network needed to run it.
const placed = (dir: ConfigDir, id: string, version: string): void => {
  const tree = dir.at(`extensions/packages/trees/${id}@${version}`);
  const name = `@agentage/extension-${id}`;
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ dependencies: { [name]: version } }));
  writeKitExtension(join(tree, 'node_modules', name), id, version);
  writeFileSync(join(tree, '.complete'), '');
};

const offline = () =>
  cliInstaller({
    npm: async () => Promise.reject(new Error('npm offline')),
    manifest: async () => Promise.reject(new Error('npm offline')),
    market: () => ({ latest: async () => null, down: () => OFFLINE }),
  });

const profile = (extensions: Record<string, string>): Profile => ({
  version: 1,
  extensions,
  registries: {},
  config: {},
  machines: {},
  extra: {},
});

// Spawns a child per extension; a sandbox that kills children fails this test, not skipped.
describe('setup through the real daemon run', () => {
  test('installs each entry, reports the one that fails, writes no marker; the next setup tries again, then the marker', async ({
    dir,
  }) => {
    placed(dir, 'alpha', '1.0.0');
    placed(dir, 'beta', '2.0.0');
    const port = await freePort();
    vi.stubEnv('AGENTAGE_DAEMON_PORT', String(port));
    const running = runDaemon({ installer: offline });
    const deps = { host: async () => hostClient(port), daemonOff: false, from: 'account' as const };
    try {
      await vi.waitFor(() => expect(dir.exists('daemon.json')).toBe(true), { timeout: 10_000 });
      const wanted = profile({
        '@agentage/extension-alpha': '1.0.0',
        '@agentage/extension-gone': '1.0.0',
        '@agentage/extension-beta': '2.0.0',
      });
      const first = await output(() => installThroughDaemon(wanted, deps));
      expect(first.lines).toEqual(['alpha 1.0.0 running', 'beta 2.0.0 running']);
      expect(first.code).toBe('extension_failed');
      expect(first.error).toMatch(
        /^not installed:\n {2}gone: .*\nthe next setup tries the profile again$/s
      );
      expect(dir.exists('setup.profile-installed')).toBe(false);
      placed(dir, 'gone', '1.0.0');
      const again = await output(() => installThroughDaemon(wanted, deps));
      expect(again.lines).toEqual([
        'alpha already installed',
        'gone 1.0.0 running',
        'beta already installed',
      ]);
      expect(dir.exists('setup.profile-installed')).toBe(true);
    } finally {
      process.emit('SIGTERM');
      await running;
      vi.unstubAllEnvs();
    }
  });
});
