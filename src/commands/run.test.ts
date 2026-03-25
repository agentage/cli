import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { EventEmitter } from 'node:events';

vi.mock('../utils/ensure-daemon.js', () => ({
  ensureDaemon: vi.fn(),
}));

vi.mock('../utils/daemon-client.js', () => ({
  get: vi.fn(),
  post: vi.fn(),
  connectWs: vi.fn(),
}));

vi.mock('../utils/render.js', () => ({
  renderEvent: vi.fn(),
}));

import { get, post, connectWs } from '../utils/daemon-client.js';
import { renderEvent } from '../utils/render.js';
import { registerRun } from './run.js';

const mockGet = vi.mocked(get);
const mockPost = vi.mocked(post);
const mockConnectWs = vi.mocked(connectWs);
const mockRenderEvent = vi.mocked(renderEvent);

describe('run command', () => {
  let program: Command;
  let logs: string[];
  let errorLogs: string[];
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    logs = [];
    errorLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    program = new Command();
    program.exitOverride();
    registerRun(program);
  });

  it('exports registerRun function', async () => {
    const mod = await import('./run.js');
    expect(typeof mod.registerRun).toBe('function');
  });

  it('errors when no prompt provided', async () => {
    await program.parseAsync(['node', 'agentage', 'run', 'hello']);

    expect(errorLogs.some((l) => l.includes('Prompt is required'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  describe('local run', () => {
    it('starts a local run and streams events via WS', async () => {
      mockPost.mockResolvedValue({ runId: 'run-123' });

      // Create a mock WS that emits events
      const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
      ws.close = vi.fn();
      ws.send = vi.fn();

      let wsCallback: (data: unknown) => void;
      mockConnectWs.mockImplementation((cb) => {
        wsCallback = cb;
        // Simulate open after a tick
        setTimeout(() => {
          ws.emit('open');
          // Then send a run event and terminal state
          wsCallback({ type: 'run_event', runId: 'run-123', event: { type: 'output', data: 'hi' } });
          wsCallback({ type: 'run_state', run: { id: 'run-123', state: 'completed' } });
        }, 10);
        return ws;
      });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello', 'do stuff']);
      await vi.advanceTimersByTimeAsync(50);
      // Drain the setTimeout in the action for process.exit
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(mockPost).toHaveBeenCalledWith('/api/agents/hello/run', {
        task: 'do stuff',
        config: undefined,
        context: undefined,
      });
      expect(mockRenderEvent).toHaveBeenCalledWith({ type: 'output', data: 'hi' });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', runId: 'run-123' }));
    });

    it('detach mode prints run ID and returns', async () => {
      mockPost.mockResolvedValue({ runId: 'run-456' });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello', 'do stuff', '-d']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(logs).toContain('run-456');
      expect(mockConnectWs).not.toHaveBeenCalled();
    });

    it('json mode outputs events as JSON lines', async () => {
      mockPost.mockResolvedValue({ runId: 'run-789' });

      const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
      ws.close = vi.fn();
      ws.send = vi.fn();

      let wsCallback: (data: unknown) => void;
      mockConnectWs.mockImplementation((cb) => {
        wsCallback = cb;
        setTimeout(() => {
          ws.emit('open');
          wsCallback({ type: 'run_event', runId: 'run-789', event: { type: 'output', data: 'hello' } });
          wsCallback({ type: 'run_state', run: { id: 'run-789', state: 'completed' } });
        }, 10);
        return ws;
      });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello', 'do stuff', '--json']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(logs[0]).toBe(JSON.stringify({ type: 'output', data: 'hello' }));
      expect(mockRenderEvent).not.toHaveBeenCalled();
    });

    it('passes config and context options', async () => {
      mockPost.mockResolvedValue({ runId: 'run-cfg' });

      const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
      ws.close = vi.fn();
      ws.send = vi.fn();
      mockConnectWs.mockImplementation((cb) => {
        setTimeout(() => {
          ws.emit('open');
          cb({ type: 'run_state', run: { id: 'run-cfg', state: 'completed' } });
        }, 10);
        return ws;
      });

      const parsePromise = program.parseAsync([
        'node', 'agentage', 'run', 'hello', 'do stuff',
        '--config', '{"model":"gpt-4"}',
        '--context', 'file1.ts', 'file2.ts',
      ]);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(mockPost).toHaveBeenCalledWith('/api/agents/hello/run', {
        task: 'do stuff',
        config: { model: 'gpt-4' },
        context: ['file1.ts', 'file2.ts'],
      });
    });

    it('handles WS error gracefully', async () => {
      mockPost.mockResolvedValue({ runId: 'run-err' });

      const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
      ws.close = vi.fn();
      ws.send = vi.fn();
      mockConnectWs.mockImplementation(() => {
        setTimeout(() => ws.emit('error', new Error('connection failed')), 10);
        return ws;
      });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      // Should resolve without throwing
    });

    it('ignores events for other runs', async () => {
      mockPost.mockResolvedValue({ runId: 'run-mine' });

      const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
      ws.close = vi.fn();
      ws.send = vi.fn();

      let wsCallback: (data: unknown) => void;
      mockConnectWs.mockImplementation((cb) => {
        wsCallback = cb;
        setTimeout(() => {
          ws.emit('open');
          // Event for a different run — should be ignored
          wsCallback({ type: 'run_event', runId: 'run-other', event: { type: 'output', data: 'nope' } });
          wsCallback({ type: 'run_state', run: { id: 'run-other', state: 'completed' } });
          // Now the actual run completes
          wsCallback({ type: 'run_state', run: { id: 'run-mine', state: 'failed' } });
        }, 10);
        return ws;
      });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(mockRenderEvent).not.toHaveBeenCalled();
    });
  });

  describe('remote run (agent@machine)', () => {
    it('resolves machine and creates remote run', async () => {
      mockGet.mockImplementation(async (path: string) => {
        if (path === '/api/hub/machines') return [{ id: 'm1', name: 'server' }];
        if (path.includes('/events')) return [];
        return { state: 'completed' };
      });
      mockPost.mockResolvedValue({ runId: 'remote-run-1' });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff', '-d']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(mockPost).toHaveBeenCalledWith('/api/hub/runs', {
        machineId: 'm1',
        agentName: 'hello',
        input: 'do stuff',
      });
      expect(logs).toContain('remote-run-1');
    });

    it('errors when not connected to hub', async () => {
      mockGet.mockRejectedValue(new Error('Unauthorized'));

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(errorLogs.some((l) => l.includes('Not connected to hub'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('errors when machine not found', async () => {
      mockGet.mockResolvedValue([{ id: 'm1', name: 'other-pc' }]);

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@missing', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(errorLogs.some((l) => l.includes('Machine "missing" not found'))).toBe(true);
      expect(errorLogs.some((l) => l.includes('other-pc'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('errors when remote run creation fails', async () => {
      mockGet.mockResolvedValue([{ id: 'm1', name: 'server' }]);
      mockPost.mockRejectedValue(new Error('Server error'));

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(errorLogs.some((l) => l.includes('Failed to start remote run'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('errors when hub returns no runId', async () => {
      mockGet.mockResolvedValue([{ id: 'm1', name: 'server' }]);
      mockPost.mockResolvedValue({});

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(errorLogs.some((l) => l.includes('Failed to get run ID'))).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('polls remote run events until terminal state', async () => {
      let pollCount = 0;
      mockGet.mockImplementation(async (path: string) => {
        if (path === '/api/hub/machines') return [{ id: 'm1', name: 'server' }];
        if (path.includes('/events')) {
          if (pollCount === 0) return [{ id: 'e1', type: 'output', data: 'progress' }];
          return [];
        }
        // Run state
        pollCount++;
        if (pollCount >= 2) return { state: 'completed' };
        return { state: 'working' };
      });
      mockPost.mockResolvedValue({ runId: 'remote-poll' });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff']);

      // Advance through poll cycles
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(1200);
      await vi.advanceTimersByTimeAsync(1200);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(mockRenderEvent).toHaveBeenCalled();
    });

    it('remote run json mode outputs JSON lines', async () => {
      mockGet.mockImplementation(async (path: string) => {
        if (path === '/api/hub/machines') return [{ id: 'm1', name: 'server' }];
        if (path.includes('/events')) return [{ id: 'e1', type: 'output', data: 'hi' }];
        return { state: 'completed' };
      });
      mockPost.mockResolvedValue({ runId: 'remote-json' });

      const parsePromise = program.parseAsync(['node', 'agentage', 'run', 'hello@server', 'do stuff', '--json']);
      await vi.advanceTimersByTimeAsync(200);
      await parsePromise.catch(() => {});

      expect(logs.some((l) => l.includes('"type":"output"'))).toBe(true);
      expect(mockRenderEvent).not.toHaveBeenCalled();
    });
  });
});
