import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linux, renderUnit, unitPath, UNIT_NAME } from './linux.js';
import type { AutostartDeps } from './types.js';

describe('linux autostart', () => {
  let homeDir: string;
  let exec: string[];
  let execShouldFail: Set<string>;
  let deps: AutostartDeps;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentage-linux-autostart-'));
    exec = [];
    execShouldFail = new Set();
    deps = {
      homeDir,
      nodeBin: '/usr/local/bin/node',
      entryPath: '/opt/agentage/dist/daemon-entry.js',
      exec: (cmd: string): void => {
        exec.push(cmd);
        if (execShouldFail.has(cmd)) {
          throw new Error(`exec failed: ${cmd}`);
        }
      },
    };
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  describe('renderUnit', () => {
    it('produces a valid systemd unit with ExecStart and WantedBy', () => {
      const unit = renderUnit('/usr/bin/node', '/opt/agentage/daemon-entry.js');
      expect(unit).toContain('Description=Agentage daemon');
      expect(unit).toContain('Type=simple');
      expect(unit).toContain('ExecStart=/usr/bin/node /opt/agentage/daemon-entry.js');
      expect(unit).toContain('Restart=on-failure');
      expect(unit).toContain('WantedBy=default.target');
    });
  });

  describe('install', () => {
    it('writes unit file, runs systemctl reload + enable, enables linger', () => {
      const result = linux.install(deps);

      expect(existsSync(unitPath(homeDir))).toBe(true);
      const written = readFileSync(unitPath(homeDir), 'utf-8');
      expect(written).toContain('ExecStart=/usr/local/bin/node /opt/agentage/dist/daemon-entry.js');

      expect(exec).toEqual([
        'systemctl --user daemon-reload',
        `systemctl --user enable --now ${UNIT_NAME}`,
        'loginctl enable-linger',
      ]);

      expect(result.mechanism).toBe('systemd-user');
      expect(result.unitPath).toBe(unitPath(homeDir));
      expect(result.startsAtBoot).toBe(true);
    });

    it('falls back to startsAtBoot=false when linger fails', () => {
      execShouldFail.add('loginctl enable-linger');

      const result = linux.install(deps);

      expect(result.startsAtBoot).toBe(false);
    });

    it('creates the systemd user dir if missing', () => {
      const result = linux.install(deps);
      const expected = join(homeDir, '.config', 'systemd', 'user');
      expect(existsSync(expected)).toBe(true);
      expect(result.unitPath.startsWith(expected)).toBe(true);
    });
  });

  describe('uninstall', () => {
    it('disables, removes the unit file, reloads', () => {
      // Pre-create unit
      mkdirSync(join(homeDir, '.config', 'systemd', 'user'), { recursive: true });
      writeFileSync(unitPath(homeDir), 'placeholder', 'utf-8');

      linux.uninstall(deps);

      expect(existsSync(unitPath(homeDir))).toBe(false);
      expect(exec).toEqual([
        `systemctl --user disable --now ${UNIT_NAME}`,
        'systemctl --user daemon-reload',
      ]);
    });

    it('is idempotent when nothing is installed', () => {
      execShouldFail.add(`systemctl --user disable --now ${UNIT_NAME}`);
      expect(() => linux.uninstall(deps)).not.toThrow();
    });
  });

  describe('isInstalled', () => {
    it('reflects the presence of the unit file', () => {
      expect(linux.isInstalled(deps)).toBe(false);
      mkdirSync(join(homeDir, '.config', 'systemd', 'user'), { recursive: true });
      writeFileSync(unitPath(homeDir), 'x', 'utf-8');
      expect(linux.isInstalled(deps)).toBe(true);
    });
  });
});
