import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  linkSync: () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  },
}));

const { acquireFileLock, releaseFileLock, withFileLock } = await import('./file-lock.js');

describe('file lock on a volume with no hard links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentage-nolink-'));
  const target = join(dir, 'up.json');
  afterEach(() => rmSync(`${target}.lock`, { force: true }));

  it('takes and releases the lock by an exclusive create', async () => {
    expect(await withFileLock(target, () => existsSync(`${target}.lock`))).toBe(true);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('still refuses a second holder', () => {
    expect(acquireFileLock(target)).toBe(true);
    expect(acquireFileLock(target)).toBe(false);
    releaseFileLock(target);
  });
});
