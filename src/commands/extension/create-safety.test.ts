import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { kitRepo, pushKit } from '../../test/kit-repo.js';
import { runExtensionCreate } from './create.js';
import { removeOwn } from './create-source.js';

let root = '';
let url = '';
const home = process.cwd();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentage-create-safe-'));
  url = kitRepo(root);
  process.chdir(root);
});
afterEach(() => {
  process.chdir(home);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const YES = { isTTY: true, prompt: async () => 'y' };
const create = (from?: string) =>
  output(() =>
    runExtensionCreate(
      { id: 'market', parts: [], ...(from && { from }) },
      () => url,
      async () => ({ installed: null, url: null }),
      YES
    )
  );
const outside = () => readdirSync(root).filter((f) => !['kit-work', 'kit.git'].includes(f));

describe('extension create keeps to its own folders', () => {
  test('a folder of yours named like the clone folder stays as it was', async () => {
    mkdirSync(join(root, '.extension-market.clone'));
    writeFileSync(join(root, '.extension-market.clone', 'mine.txt'), 'mine');
    expect((await create()).error).toBeNull();
    expect(readFileSync(join(root, '.extension-market.clone', 'mine.txt'), 'utf8')).toBe('mine');
    expect(outside().sort()).toEqual(['.extension-market.clone', 'extension-market']);
  });

  test.for([
    ['in the folder', 'template/src', 'agentage/kit:template'],
    ['at the root', 'src', 'agentage/extension-template'],
  ])('refuses a template with a symbolic link %s, nothing left', async ([, at = '', from]) => {
    mkdirSync(join(root, 'kit-work', at), { recursive: true });
    symlinkSync(root, join(root, 'kit-work', at, 'out'));
    pushKit(root);
    const { error } = await create(from);
    expect(error).toBe(`template ${from}: a symbolic link extension-market/src/out`);
    expect(outside()).toEqual([]);
    expect(existsSync(join(root, 'kit-work'))).toBe(true);
  });

  test('Ctrl-C during the clone removes this run only, then the signal ends the process', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const before = process.listeners('SIGINT');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nsleep 0.5\nexit 1\n', { mode: 0o755 });
    const path = process.env['PATH'];
    process.env['PATH'] = `${bin}:${path ?? ''}`;
    try {
      const running = create();
      await vi.waitFor(() => expect(process.listeners('SIGINT').length).toBe(before.length + 1));
      const [onSigint] = process.listeners('SIGINT').filter((l) => !before.includes(l));
      onSigint?.('SIGINT');
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT'));
      expect(outside()).toEqual(['bin']);
      await running;
    } finally {
      process.env['PATH'] = path;
    }
    expect(process.listeners('SIGINT')).toEqual(before);
  });

  test('removeOwn never throws, also for a folder already gone', () => {
    expect(() => removeOwn(join(root, 'none'))).not.toThrow();
  });
});
