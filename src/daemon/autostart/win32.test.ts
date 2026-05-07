import { describe, expect, it, beforeEach } from 'vitest';
import { buildCreateCommand, TASK_NAME, win32 } from './win32.js';
import type { AutostartDeps } from './types.js';

describe('win32 autostart', () => {
  let exec: string[];
  let execShouldFail: Set<string>;
  let deps: AutostartDeps;

  beforeEach(() => {
    exec = [];
    execShouldFail = new Set();
    deps = {
      homeDir: 'C:\\Users\\me',
      nodeBin: 'C:\\Program Files\\nodejs\\node.exe',
      entryPath:
        'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentage\\cli\\dist\\daemon-entry.js',
      exec: (cmd: string): void => {
        exec.push(cmd);
        if (execShouldFail.has(cmd)) throw new Error(`exec failed: ${cmd}`);
      },
    };
  });

  describe('buildCreateCommand', () => {
    it('escapes inner quotes for cmd.exe and uses ONLOGON trigger', () => {
      const cmd = buildCreateCommand('C:\\node.exe', 'C:\\daemon.js');
      expect(cmd).toContain('schtasks /Create');
      expect(cmd).toContain(`/TN "${TASK_NAME}"`);
      expect(cmd).toContain('/SC ONLOGON');
      expect(cmd).toContain('/RL LIMITED');
      expect(cmd).toContain('/F');
      // The /TR string contains escaped inner quotes around each path
      expect(cmd).toContain('/TR "\\"C:\\node.exe\\" \\"C:\\daemon.js\\""');
    });
  });

  describe('install', () => {
    it('runs schtasks /Create with ONLOGON trigger', () => {
      const result = win32.install(deps);

      expect(exec).toHaveLength(1);
      expect(exec[0]).toContain('schtasks /Create');
      expect(exec[0]).toContain('/SC ONLOGON');
      expect(exec[0]).toContain(TASK_NAME);
      expect(exec[0]).toContain('node.exe');

      expect(result.mechanism).toBe('schtasks-onlogon');
      expect(result.unitPath).toBe(TASK_NAME);
      expect(result.startsAtBoot).toBe(false);
    });
  });

  describe('uninstall', () => {
    it('deletes the scheduled task', () => {
      win32.uninstall(deps);
      expect(exec).toEqual([`schtasks /Delete /TN "${TASK_NAME}" /F`]);
    });

    it('is idempotent when delete fails', () => {
      execShouldFail.add(`schtasks /Delete /TN "${TASK_NAME}" /F`);
      expect(() => win32.uninstall(deps)).not.toThrow();
    });
  });

  describe('isInstalled', () => {
    it('returns true when schtasks /Query succeeds', () => {
      expect(win32.isInstalled(deps)).toBe(true);
    });

    it('returns false when schtasks /Query throws', () => {
      execShouldFail.add(`schtasks /Query /TN "${TASK_NAME}"`);
      expect(win32.isInstalled(deps)).toBe(false);
    });
  });
});
