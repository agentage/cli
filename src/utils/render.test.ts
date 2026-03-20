import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type RunEvent } from '@agentage/core';

describe('render', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders text format as-is', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: 'Hello world', format: 'text' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('Hello world');
  });

  it('renders llm.delta inline', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: { text: 'token' }, format: 'llm.delta' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('token');
  });

  it('renders llm.tool_call with arrow syntax', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { name: 'search', input: { query: 'test' } },
        format: 'llm.tool_call',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs).toContain('tool: search');
  });

  it('renders progress with percent', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { percent: 45, message: 'Building...' },
        format: 'progress',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs).toContain('[45%]');
    expect(callArgs).toContain('Building...');
  });

  it('renders unknown format as JSON.stringify', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: { custom: 'data' }, format: 'unknown-format' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ custom: 'data' }));
  });

  it('renders result event', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'result',
      data: { type: 'result', success: true, output: 'All done' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('All done');
  });

  it('renders error event', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'error',
      data: { type: 'error', code: 'ERR', message: 'Something failed', recoverable: false },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders markdown format as-is', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: '## Title', format: 'markdown' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('## Title');
  });

  it('renders output without format', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: 'no format' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('no format');
  });

  it('renders non-string content as JSON in text format', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: { key: 'value' }, format: 'text' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('{"key":"value"}');
  });

  it('renders llm.thinking in dim text', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: { text: 'thinking...' }, format: 'llm.thinking' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders llm.tool_result with truncation', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const longOutput = 'x'.repeat(300);
    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { output: longOutput },
        format: 'llm.tool_result',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs).toContain('...');
  });

  it('renders llm.usage', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { input: 1234, output: 567 },
        format: 'llm.usage',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs).toContain('Tokens');
  });

  it('renders json format', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: { data: [1, 2, 3] }, format: 'json' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ data: [1, 2, 3] }, null, 2));
  });

  it('renders state completed', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'state',
      data: { type: 'state', state: 'completed' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders state failed', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'state',
      data: { type: 'state', state: 'failed', message: 'oops' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders state input_required', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'state',
      data: { type: 'state', state: 'input_required' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders input_required event with prompt', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'input_required',
      data: { type: 'input_required', prompt: 'Enter your name:' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders result with object output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'result',
      data: { type: 'result', success: true, output: { key: 'value' } },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }, null, 2));
  });

  it('skips result with no output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'result',
      data: { type: 'result', success: true },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders llm.delta without text', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: {}, format: 'llm.delta' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders progress without percent', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { message: 'Loading...' },
        format: 'progress',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalledWith('Loading...');
  });

  it('renders llm.tool_result with non-string output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: {
        type: 'output',
        content: { output: { nested: true } },
        format: 'llm.tool_result',
      },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders state failed without message', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'state',
      data: { type: 'state', state: 'failed' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0][0] as string;
    expect(callArgs).toContain('Unknown error');
  });

  it('ignores non-terminal state events', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'state',
      data: { type: 'state', state: 'working' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders llm.usage with no values', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { renderEvent } = await import('./render.js');

    const event: RunEvent = {
      type: 'output',
      data: { type: 'output', content: {}, format: 'llm.usage' },
      timestamp: Date.now(),
    };

    renderEvent(event);
    expect(spy).toHaveBeenCalled();
  });
});
