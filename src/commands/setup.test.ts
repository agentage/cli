import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigDir: vi.fn(),
  getDefaultVaultsDir: vi.fn(
    (cfg?: { vaultsDefault?: string }) =>
      process.env['AGENTAGE_DEFAULT_VAULTS_DIR'] ||
      cfg?.vaultsDefault ||
      '/nonexistent-default-vaults'
  ),
}));

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../hub/auth.js', () => ({
  readAuth: vi.fn(),
  saveAuth: vi.fn(),
  deleteAuth: vi.fn(),
}));

vi.mock('../hub/auth-callback.js', () => ({
  startCallbackServer: vi.fn(),
  getCallbackPort: vi.fn(),
}));

vi.mock('../hub/hub-client.js', () => ({
  createHubClient: vi.fn(),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('../utils/action-client.js', () => ({
  invokeAction: vi.fn(),
}));

const mockQuestion = vi.fn();
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

import { loadConfig, saveConfig, getConfigDir } from '../daemon/config.js';
import { readAuth, saveAuth, deleteAuth } from '../hub/auth.js';
import { startCallbackServer, getCallbackPort } from '../hub/auth-callback.js';
import { createHubClient } from '../hub/hub-client.js';
import { invokeAction } from '../utils/action-client.js';
import { registerSetup } from './setup.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockGetConfigDir = vi.mocked(getConfigDir);
const mockReadAuth = vi.mocked(readAuth);
const mockSaveAuth = vi.mocked(saveAuth);
const mockDeleteAuth = vi.mocked(deleteAuth);
const mockStartCallback = vi.mocked(startCallbackServer);
const mockGetCallbackPort = vi.mocked(getCallbackPort);
const mockCreateHubClient = vi.mocked(createHubClient);
const mockInvokeAction = vi.mocked(invokeAction);

const baseConfig = () => ({
  machine: { id: 'machine-existing-1', name: 'test-host' },
  daemon: { port: 4243 },
  agents: { default: '/tmp/agents', additional: [] as string[] },
  projects: { default: '/tmp/projects', additional: [] as string[] },
  sync: {
    events: {
      state: true,
      result: true,
      error: true,
      input_required: true,
      'output.llm.delta': true,
      'output.llm.tool_call': true,
      'output.llm.usage': true,
      'output.progress': true,
    },
  },
});

describe('setup command', () => {
  let program: Command;
  let tempDir: string;
  let logs: string[];
  let errorLogs: string[];
  let originalIsTTY: boolean | undefined;

  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  const setTty = (isTty: boolean): void => {
    Object.defineProperty(process.stdout, 'isTTY', { value: isTty, configurable: true });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'agentage-setup-test-'));
    logs = [];
    errorLogs = [];
    originalIsTTY = process.stdout.isTTY;

    mockGetConfigDir.mockReturnValue(tempDir);
    mockLoadConfig.mockReturnValue(
      structuredClone(baseConfig()) as unknown as ReturnType<typeof loadConfig>
    );
    mockReadAuth.mockReturnValue(null);
    mockQuestion.mockReset();
    mockQuestion.mockResolvedValue('y');

    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerSetup(program);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  describe('flag validation', () => {
    it('exits 3 on --reauth + --disconnect', async () => {
      await program.parseAsync(['node', 'agentage', 'setup', '--reauth', '--disconnect']);
      expect(errorLogs.some((l) => l.includes('cannot be combined'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(3);
    });
  });

  describe('disconnect mode', () => {
    it('prints not-logged-in when no auth', async () => {
      await program.parseAsync(['node', 'agentage', 'setup', '--disconnect']);
      expect(logs.some((l) => l.includes('Not logged in'))).toBe(true);
      expect(mockDeleteAuth).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('deregisters and deletes auth when logged in', async () => {
      const dereg = vi.fn().mockResolvedValue(undefined);
      mockReadAuth.mockReturnValue({
        session: { access_token: 't', refresh_token: 'r', expires_at: 9999 },
        user: { id: 'u1', email: 'e@x.io' },
        hub: { url: 'https://hub.x', machineId: 'machine-existing-1' },
      });
      mockCreateHubClient.mockReturnValue({ deregister: dereg } as unknown as ReturnType<
        typeof createHubClient
      >);

      await program.parseAsync(['node', 'agentage', 'setup', '--disconnect']);

      expect(dereg).toHaveBeenCalledWith('machine-existing-1');
      expect(mockDeleteAuth).toHaveBeenCalled();
      expect(logs.some((l) => l.includes('Disconnected from hub'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('still deletes auth when deregister fails', async () => {
      mockReadAuth.mockReturnValue({
        session: { access_token: 't', refresh_token: '', expires_at: 0 },
        user: { id: 'u1', email: '' },
        hub: { url: 'https://hub.x', machineId: 'machine-existing-1' },
      });
      mockCreateHubClient.mockReturnValue({
        deregister: vi.fn().mockRejectedValue(new Error('Network')),
      } as unknown as ReturnType<typeof createHubClient>);

      await program.parseAsync(['node', 'agentage', 'setup', '--disconnect']);

      expect(mockDeleteAuth).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('idempotent mode', () => {
    it('shows summary when auth exists and no explicit changes', async () => {
      setTty(true);
      mockReadAuth.mockReturnValue({
        session: { access_token: 't', refresh_token: 'r', expires_at: 9999 },
        user: { id: 'u1', email: 'me@x.io' },
        hub: { url: 'https://hub.x', machineId: 'machine-existing-1' },
      });

      await program.parseAsync(['node', 'agentage', 'setup']);

      expect(logs.some((l) => l.includes('Already configured'))).toBe(true);
      expect(logs.some((l) => l.includes('me@x.io'))).toBe(true);
      expect(mockSaveAuth).not.toHaveBeenCalled();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('non-interactive guard', () => {
    it('exits 2 when no TTY, no --token, no --no-login', async () => {
      setTty(false);
      await program.parseAsync(['node', 'agentage', 'setup']);
      expect(errorLogs.some((l) => l.includes('cannot prompt'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(2);
    });

    it('exits 2 with --no-interactive even when TTY is present', async () => {
      setTty(true);
      await program.parseAsync(['node', 'agentage', 'setup', '--no-interactive']);
      expect(errorLogs.some((l) => l.includes('cannot prompt'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(2);
    });
  });

  describe('fresh setup with TTY confirmation', () => {
    it('proceeds on Enter and opens browser', async () => {
      setTty(true);
      mockQuestion.mockResolvedValue('');
      mockStartCallback.mockResolvedValue({
        session: { access_token: 'at', refresh_token: 'rt', expires_at: 9999 },
        user: { id: 'u1', email: 'v@x.io' },
        hub: { url: '', machineId: '' },
      });
      mockGetCallbackPort.mockReturnValue(54321);

      await program.parseAsync(['node', 'agentage', 'setup']);

      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockStartCallback).toHaveBeenCalled();
      expect(mockSaveAuth).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('aborts on `n`', async () => {
      setTty(true);
      mockQuestion.mockResolvedValue('n');

      await program.parseAsync(['node', 'agentage', 'setup']);

      expect(logs.some((l) => l.includes('Aborted'))).toBe(true);
      expect(mockSaveAuth).not.toHaveBeenCalled();
      expect(mockStartCallback).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('--token (headless)', () => {
    it('saves auth without browser', async () => {
      setTty(true);
      await program.parseAsync(['node', 'agentage', 'setup', '--token', 'my-token']);

      expect(mockSaveAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ access_token: 'my-token' }),
          hub: expect.objectContaining({ url: 'https://agentage.io' }),
        })
      );
      expect(mockStartCallback).not.toHaveBeenCalled();
      expect(mockQuestion).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('--machine-id (cloud-init path)', () => {
    it('writes machine.json with supplied id and name before daemon starts', async () => {
      setTty(false);
      const id = '11111111-2222-3333-4444-555555555555';
      await program.parseAsync([
        'node',
        'agentage',
        'setup',
        '--machine-id',
        id,
        '--name',
        'cloud-vm',
        '--token',
        'tk',
        '--hub',
        'https://my.hub',
      ]);

      const path = join(tempDir, 'machine.json');
      expect(existsSync(path)).toBe(true);
      const written = JSON.parse(readFileSync(path, 'utf-8')) as { id: string; name: string };
      expect(written).toEqual({ id, name: 'cloud-vm' });
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('errors on rename without --force', async () => {
      setTty(true);
      writeFileSync(
        join(tempDir, 'machine.json'),
        JSON.stringify({ id: 'existing-id', name: 'old-name' })
      );

      await program.parseAsync([
        'node',
        'agentage',
        'setup',
        '--name',
        'new-name',
        '--token',
        'tk',
      ]);

      expect(errorLogs.some((l) => l.includes('--force'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(7);
    });

    it('allows rename with --force', async () => {
      setTty(true);
      writeFileSync(
        join(tempDir, 'machine.json'),
        JSON.stringify({ id: 'existing-id', name: 'old-name' })
      );

      await program.parseAsync([
        'node',
        'agentage',
        'setup',
        '--name',
        'new-name',
        '--token',
        'tk',
        '--force',
      ]);

      const written = JSON.parse(readFileSync(join(tempDir, 'machine.json'), 'utf-8')) as {
        id: string;
        name: string;
      };
      expect(written.name).toBe('new-name');
      expect(written.id).toBe('existing-id');
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('--reauth', () => {
    it('skips confirmation and re-runs OAuth keeping existing config', async () => {
      setTty(true);
      mockReadAuth.mockReturnValue({
        session: { access_token: 'old', refresh_token: 'r', expires_at: 0 },
        user: { id: 'u1', email: 'me@x.io' },
        hub: { url: 'https://hub.x', machineId: 'machine-existing-1' },
      });
      mockStartCallback.mockResolvedValue({
        session: { access_token: 'new', refresh_token: 'r2', expires_at: 9999 },
        user: { id: 'u1', email: 'me@x.io' },
        hub: { url: '', machineId: '' },
      });
      mockGetCallbackPort.mockReturnValue(54321);

      await program.parseAsync(['node', 'agentage', 'setup', '--reauth']);

      expect(mockQuestion).not.toHaveBeenCalled();
      expect(mockStartCallback).toHaveBeenCalled();
      expect(mockSaveAuth).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('--no-login (standalone)', () => {
    it('saves config but does not authenticate', async () => {
      setTty(true);
      await program.parseAsync(['node', 'agentage', 'setup', '--no-login', '--yes']);

      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockSaveAuth).not.toHaveBeenCalled();
      expect(mockStartCallback).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes('Standalone'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('--json', () => {
    it('emits JSON summary on fresh setup with --token', async () => {
      setTty(false);
      await program.parseAsync([
        'node',
        'agentage',
        'setup',
        '--token',
        'tk',
        '--name',
        'my-pc',
        '--json',
      ]);

      const jsonLine = logs.find((l) => l.trim().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!) as {
        ok: boolean;
        mode: string;
        machine: { name: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.mode).toBe('fresh');
      expect(parsed.machine.name).toBe('my-pc');
    });
  });

  describe('hub URL normalization', () => {
    it('auto-prepends https:// when scheme is missing', async () => {
      setTty(false);
      await program.parseAsync(['node', 'agentage', 'setup', '--hub', 'my.hub', '--token', 'tk']);

      const savedConfig = mockSaveConfig.mock.calls[0]![0];
      expect(savedConfig.hub).toEqual({ url: 'https://my.hub' });
    });

    it('preserves http:// for local URLs', async () => {
      setTty(false);
      await program.parseAsync([
        'node',
        'agentage',
        'setup',
        '--hub',
        'http://localhost:3001',
        '--token',
        'tk',
      ]);

      const savedConfig = mockSaveConfig.mock.calls[0]![0];
      expect(savedConfig.hub).toEqual({ url: 'http://localhost:3001' });
    });
  });

  describe('removal of init/login/logout', () => {
    it('agentage init exits with unknown command', async () => {
      const cleanProgram = new Command();
      cleanProgram.exitOverride();
      registerSetup(cleanProgram);

      await expect(cleanProgram.parseAsync(['node', 'agentage', 'init'])).rejects.toThrow();
    });

    it('agentage login exits with unknown command', async () => {
      const cleanProgram = new Command();
      cleanProgram.exitOverride();
      registerSetup(cleanProgram);

      await expect(cleanProgram.parseAsync(['node', 'agentage', 'login'])).rejects.toThrow();
    });

    it('agentage logout exits with unknown command', async () => {
      const cleanProgram = new Command();
      cleanProgram.exitOverride();
      registerSetup(cleanProgram);

      await expect(cleanProgram.parseAsync(['node', 'agentage', 'logout'])).rejects.toThrow();
    });
  });

  describe('vault step (multi-vault directory scan)', () => {
    let vaultsParent: string;

    beforeEach(() => {
      vaultsParent = mkdtempSync(join(tmpdir(), 'agentage-vaults-parent-'));
      process.env['AGENTAGE_DEFAULT_VAULTS_DIR'] = vaultsParent;
    });

    afterEach(() => {
      delete process.env['AGENTAGE_DEFAULT_VAULTS_DIR'];
      rmSync(vaultsParent, { recursive: true, force: true });
    });

    it('auto-registers each subdirectory in the vaults dir as a vault', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });
      mk(join(vaultsParent, 'work'), { recursive: true });

      mockInvokeAction.mockImplementation(async (_name, input) => {
        const i = input as { path: string };
        return {
          slug: i.path.endsWith('notes') ? 'notes' : 'work',
          uuid: `uuid-${i.path}`,
          path: i.path,
          fileCount: i.path.endsWith('notes') ? 5 : 12,
        };
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1']);
      } catch {
        // ignore exitOverride
      }

      const calledPaths = mockInvokeAction.mock.calls.map((c) => (c[1] as { path: string }).path);
      expect(calledPaths.sort()).toEqual([join(vaultsParent, 'notes'), join(vaultsParent, 'work')]);
    });

    it('skips dotfiles and non-directories under the vaults dir', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, '.hidden'), { recursive: true });
      mk(join(vaultsParent, 'real'), { recursive: true });
      writeFileSync(join(vaultsParent, 'NOT-A-DIR.md'), 'x');

      mockInvokeAction.mockResolvedValue({
        slug: 'real',
        uuid: 'u',
        path: join(vaultsParent, 'real'),
        fileCount: 0,
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1']);
      } catch {}

      expect(mockInvokeAction).toHaveBeenCalledTimes(1);
      const call = mockInvokeAction.mock.calls[0];
      expect((call?.[1] as { path: string }).path).toBe(join(vaultsParent, 'real'));
    });

    it('silently skips already-registered subdirs on re-run', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });

      mockInvokeAction.mockRejectedValueOnce(
        new Error('action vault:add failed: INVALID_INPUT: vault "notes" already exists')
      );
      const errLogs: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => {
        errLogs.push(String(m));
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1']);
      } catch {}

      // "already exists" must not produce a warning
      expect(errLogs.some((l) => l.includes('already exists'))).toBe(false);
      expect(errLogs.some((l) => l.includes('vault scan'))).toBe(false);
      errSpy.mockRestore();
    });

    it('--no-vault skips the scan entirely', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1', '--no-vault']);
      } catch {}
      expect(mockInvokeAction).not.toHaveBeenCalled();
    });

    it('--vault <path> adds an extra vault on top of the dir scan', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });
      const extra = mkdtempSync(join(tmpdir(), 'agentage-extra-'));

      try {
        mockInvokeAction.mockResolvedValue({
          slug: 'x',
          uuid: 'u',
          path: '',
          fileCount: 0,
        });

        try {
          await program.parseAsync([
            'node',
            'agentage',
            'setup',
            '--token',
            't1',
            '--vault',
            extra,
            '--vault-slug',
            'extra',
          ]);
        } catch {}

        const paths = mockInvokeAction.mock.calls.map((c) => (c[1] as { path: string }).path);
        expect(paths).toContain(join(vaultsParent, 'notes'));
        expect(paths).toContain(extra);

        const extraCall = mockInvokeAction.mock.calls.find(
          (c) => (c[1] as { path: string }).path === extra
        );
        expect((extraCall?.[1] as { slug?: string }).slug).toBe('extra');
      } finally {
        rmSync(extra, { recursive: true, force: true });
      }
    });

    it('--vaults-dir overrides the default and persists to config', async () => {
      const customDir = mkdtempSync(join(tmpdir(), 'agentage-custom-vaults-'));
      try {
        const { mkdirSync: mk } = await import('node:fs');
        mk(join(customDir, 'a'), { recursive: true });

        mockInvokeAction.mockResolvedValue({
          slug: 'a',
          uuid: 'u',
          path: join(customDir, 'a'),
          fileCount: 0,
        });

        try {
          await program.parseAsync([
            'node',
            'agentage',
            'setup',
            '--token',
            't1',
            '--vaults-dir',
            customDir,
          ]);
        } catch {}

        // Persisted into config.vaultsDefault via saveConfig
        const lastSave = mockSaveConfig.mock.calls.at(-1);
        expect((lastSave?.[0] as { vaultsDefault?: string }).vaultsDefault).toBe(customDir);
      } finally {
        rmSync(customDir, { recursive: true, force: true });
      }
    });

    it('--reauth skips vault step (only fresh mode auto-registers)', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });

      mockReadAuth.mockReturnValue({
        session: { access_token: 'tok', refresh_token: '', expires_at: 0 },
        user: { id: 'u', email: 'u@example.com' },
        hub: { url: 'https://h.example.com', machineId: 'm-1' },
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--reauth', '--token', 't2']);
      } catch {}
      expect(mockInvokeAction).not.toHaveBeenCalled();
    });

    it('JSON output includes vaults.defaultDir + vaults.registered', async () => {
      const { mkdirSync: mk } = await import('node:fs');
      mk(join(vaultsParent, 'notes'), { recursive: true });

      mockInvokeAction.mockResolvedValueOnce({
        slug: 'notes',
        uuid: 'json-uuid',
        path: join(vaultsParent, 'notes'),
        fileCount: 3,
      });

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => {
        logs.push(String(m));
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1', '--json']);
      } catch {}

      const jsonLog = logs.find((l) => l.startsWith('{'));
      expect(jsonLog).toBeDefined();
      const parsed = JSON.parse(jsonLog as string);
      expect(parsed.vaults.defaultDir).toBe(vaultsParent);
      expect(parsed.vaults.registered).toHaveLength(1);
      expect(parsed.vaults.registered[0]).toMatchObject({
        slug: 'notes',
        uuid: 'json-uuid',
        fileCount: 3,
      });
      logSpy.mockRestore();
    });

    it('absent vaults dir → no action calls, no warning', async () => {
      // Point env to a non-existent path
      process.env['AGENTAGE_DEFAULT_VAULTS_DIR'] = '/this/path/does/not/exist';
      const errLogs: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => {
        errLogs.push(String(m));
      });

      try {
        await program.parseAsync(['node', 'agentage', 'setup', '--token', 't1']);
      } catch {}

      expect(mockInvokeAction).not.toHaveBeenCalled();
      expect(errLogs.some((l) => l.toLowerCase().includes('vault'))).toBe(false);
      errSpy.mockRestore();
    });
  });
});

describe('buildAuthUrl', () => {
  it('builds bare URL with cli_port only when machineName missing', async () => {
    const { buildAuthUrl } = await import('./setup.js');
    expect(buildAuthUrl('https://agentage.io', 4243, undefined)).toBe(
      'https://agentage.io/login?cli_port=4243'
    );
  });

  it('appends URL-encoded machine_name when provided', async () => {
    const { buildAuthUrl } = await import('./setup.js');
    expect(buildAuthUrl('https://agentage.io', 4243, 'vreshch-laptop')).toBe(
      'https://agentage.io/login?cli_port=4243&machine_name=vreshch-laptop'
    );
  });

  it('URL-encodes spaces and special chars in machine_name', async () => {
    const { buildAuthUrl } = await import('./setup.js');
    const url = buildAuthUrl('https://agentage.io', 4243, "Bob's Mac Mini");
    expect(url).toContain('machine_name=Bob%27s+Mac+Mini');
  });

  it('omits machine_name when empty string', async () => {
    const { buildAuthUrl } = await import('./setup.js');
    expect(buildAuthUrl('https://agentage.io', 4243, '')).toBe(
      'https://agentage.io/login?cli_port=4243'
    );
  });
});
