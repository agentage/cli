import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}));

vi.mock('../daemon/config.js', () => ({
  loadConfig: vi.fn(() => ({
    machine: { id: '11111111-1111-1111-1111-111111111111', name: 'localdev' },
    daemon: { port: 4243 },
    agents: { default: '/tmp/agents', additional: [] },
    projects: { default: '/tmp/projects', additional: [] },
    sync: { events: {} },
  })),
}));

import { get, post, request } from '../utils/daemon-client.js';
import { registerSchedules } from './schedules.js';

const mockGet = vi.mocked(get);
const mockPost = vi.mocked(post);
const mockRequest = vi.mocked(request);

const sampleSchedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'sch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'morning brief',
  agent_name: 'echo',
  machine_id: '11111111-1111-1111-1111-111111111111',
  cron: '0 9 * * *',
  timezone: 'UTC',
  enabled: true,
  next_fire_at: '2030-01-01T09:00:00.000Z',
  last_fired_at: null,
  ...overrides,
});

describe('schedules command', () => {
  let program: Command;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    program = new Command();
    program.exitOverride();
    registerSchedules(program);
  });

  describe('list (default)', () => {
    it('prints empty message when no schedules', async () => {
      mockGet.mockResolvedValue([]);
      await program.parseAsync(['node', 'agentage', 'schedules']);
      expect(mockGet).toHaveBeenCalledWith('/api/hub/schedules');
      expect(logs.some((l) => l.includes('No schedules'))).toBe(true);
    });

    it('prints table with one schedule', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      await program.parseAsync(['node', 'agentage', 'schedules']);
      expect(logs.some((l) => l.includes('NAME'))).toBe(true);
      expect(logs.some((l) => l.includes('morning brief'))).toBe(true);
      expect(logs.some((l) => l.includes('0 9 * * *'))).toBe(true);
    });

    it('passes --machine filter', async () => {
      mockGet.mockResolvedValue([]);
      await program.parseAsync(['node', 'agentage', 'schedules', '--machine', 'm-1']);
      expect(mockGet).toHaveBeenCalledWith('/api/hub/schedules?machine=m-1');
    });

    it('passes --enabled filter', async () => {
      mockGet.mockResolvedValue([]);
      await program.parseAsync(['node', 'agentage', 'schedules', '--enabled']);
      expect(mockGet).toHaveBeenCalledWith('/api/hub/schedules?enabled=true');
    });

    it('--json prints JSON', async () => {
      const data = [sampleSchedule()];
      mockGet.mockResolvedValue(data);
      await program.parseAsync(['node', 'agentage', 'schedules', '--json']);
      expect(JSON.parse(logs[0]!)).toEqual(data);
    });
  });

  describe('add', () => {
    it('expands preset name to full cron', async () => {
      mockPost.mockResolvedValue(sampleSchedule());
      await program.parseAsync(['node', 'agentage', 'schedules', 'add', 'echo', 'daily']);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/hub/schedules',
        expect.objectContaining({
          agentName: 'echo',
          cron: '0 9 * * *',
          machineId: '11111111-1111-1111-1111-111111111111',
        })
      );
    });

    it('passes raw cron through', async () => {
      mockPost.mockResolvedValue(sampleSchedule());
      await program.parseAsync(['node', 'agentage', 'schedules', 'add', 'echo', '0 20 * * 1-5']);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/hub/schedules',
        expect.objectContaining({ cron: '0 20 * * 1-5' })
      );
    });

    it('--task wraps as input.task', async () => {
      mockPost.mockResolvedValue(sampleSchedule());
      await program.parseAsync([
        'node',
        'agentage',
        'schedules',
        'add',
        'echo',
        'hourly',
        '--task',
        'morning brief',
      ]);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/hub/schedules',
        expect.objectContaining({ input: { task: 'morning brief' } })
      );
    });
  });

  describe('enable / disable / remove', () => {
    it('enable PATCHes enabled=true', async () => {
      mockGet.mockResolvedValue([sampleSchedule({ enabled: false })]);
      mockRequest.mockResolvedValue({});
      await program.parseAsync(['node', 'agentage', 'schedules', 'enable', 'sch-aaaa']);
      expect(mockRequest).toHaveBeenCalledWith(
        'PATCH',
        '/api/hub/schedules/sch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        { enabled: true }
      );
    });

    it('disable PATCHes enabled=false', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      mockRequest.mockResolvedValue({});
      await program.parseAsync(['node', 'agentage', 'schedules', 'disable', 'sch-aaaa']);
      expect(mockRequest).toHaveBeenCalledWith(
        'PATCH',
        '/api/hub/schedules/sch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        { enabled: false }
      );
    });

    it('remove DELETEs', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      mockRequest.mockResolvedValue({});
      await program.parseAsync(['node', 'agentage', 'schedules', 'remove', 'sch-aaaa']);
      expect(mockRequest).toHaveBeenCalledWith(
        'DELETE',
        '/api/hub/schedules/sch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      );
    });

    it('rejects ambiguous id prefix', async () => {
      mockGet.mockResolvedValue([
        sampleSchedule({ id: 'sch-aaaa-1' }),
        sampleSchedule({ id: 'sch-aaaa-2' }),
      ]);
      await expect(
        program.parseAsync(['node', 'agentage', 'schedules', 'enable', 'sch-aaaa'])
      ).rejects.toThrow(/Ambiguous/);
    });

    it('rejects unknown id prefix', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      await expect(
        program.parseAsync(['node', 'agentage', 'schedules', 'remove', 'nope-xxx'])
      ).rejects.toThrow(/No schedule matches/);
    });
  });

  describe('run-now', () => {
    it('POSTs run-now and prints runId', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      mockPost.mockResolvedValue({ runId: 'run-12345678-...' });
      await program.parseAsync(['node', 'agentage', 'schedules', 'run-now', 'sch-aaaa']);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/hub/schedules/sch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/run-now'
      );
      expect(logs.some((l) => l.includes('Fired'))).toBe(true);
    });
  });

  describe('next', () => {
    it('prints 5 future fire times', async () => {
      mockGet.mockResolvedValue([sampleSchedule()]);
      await program.parseAsync(['node', 'agentage', 'schedules', 'next', 'sch-aaaa']);
      expect(logs).toHaveLength(5);
      expect(new Date(logs[0]!).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
