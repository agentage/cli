import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { darwin, LABEL, plistPath, renderPlist } from './darwin.js';
import type { AutostartDeps } from './types.js';

describe('darwin autostart', () => {
  let homeDir: string;
  let exec: string[];
  let execShouldFail: Set<string>;
  let deps: AutostartDeps;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentage-darwin-autostart-'));
    exec = [];
    execShouldFail = new Set();
    deps = {
      homeDir,
      nodeBin: '/usr/local/bin/node',
      entryPath: '/opt/agentage/dist/daemon-entry.js',
      exec: (cmd: string): void => {
        exec.push(cmd);
        if (execShouldFail.has(cmd)) throw new Error(`exec failed: ${cmd}`);
      },
    };
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  describe('renderPlist', () => {
    it('produces a plist with Label, ProgramArguments, RunAtLoad, KeepAlive', () => {
      const plist = renderPlist('/usr/bin/node', '/x/daemon-entry.js', '/Users/me');
      expect(plist).toContain(`<string>${LABEL}</string>`);
      expect(plist).toContain('<string>/usr/bin/node</string>');
      expect(plist).toContain('<string>/x/daemon-entry.js</string>');
      expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
      expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    });

    it('escapes XML special characters in paths', () => {
      const plist = renderPlist('/usr/bin/node', '/x & y/daemon.js', '/h');
      expect(plist).toContain('/x &amp; y/daemon.js');
    });
  });

  describe('install', () => {
    it('writes plist and bootstraps the agent', () => {
      // First call to bootout fails (not loaded) — that's expected & swallowed.
      execShouldFail.add(`launchctl bootout gui/$(id -u)/${LABEL}`);

      const result = darwin.install(deps);

      const path = plistPath(homeDir);
      expect(existsSync(path)).toBe(true);
      const written = readFileSync(path, 'utf-8');
      expect(written).toContain('/usr/local/bin/node');
      expect(written).toContain('/opt/agentage/dist/daemon-entry.js');

      expect(exec).toEqual([
        `launchctl bootout gui/$(id -u)/${LABEL}`,
        `launchctl bootstrap gui/$(id -u) "${path}"`,
      ]);

      expect(result.mechanism).toBe('launchd-agent');
      expect(result.unitPath).toBe(path);
      expect(result.startsAtBoot).toBe(false);
    });

    it('creates LaunchAgents and logs dirs', () => {
      execShouldFail.add(`launchctl bootout gui/$(id -u)/${LABEL}`);
      darwin.install(deps);
      expect(existsSync(join(homeDir, 'Library', 'LaunchAgents'))).toBe(true);
      expect(existsSync(join(homeDir, '.agentage', 'logs'))).toBe(true);
    });
  });

  describe('uninstall', () => {
    it('boots out and removes the plist', () => {
      execShouldFail.add(`launchctl bootout gui/$(id -u)/${LABEL}`);
      darwin.install(deps);
      exec.length = 0;
      execShouldFail.clear();

      darwin.uninstall(deps);

      expect(existsSync(plistPath(homeDir))).toBe(false);
      expect(exec).toEqual([`launchctl bootout gui/$(id -u)/${LABEL}`]);
    });

    it('is idempotent when nothing installed', () => {
      execShouldFail.add(`launchctl bootout gui/$(id -u)/${LABEL}`);
      expect(() => darwin.uninstall(deps)).not.toThrow();
    });
  });

  describe('isInstalled', () => {
    it('reflects plist presence', () => {
      expect(darwin.isInstalled(deps)).toBe(false);
      execShouldFail.add(`launchctl bootout gui/$(id -u)/${LABEL}`);
      darwin.install(deps);
      expect(darwin.isInstalled(deps)).toBe(true);
    });
  });
});
