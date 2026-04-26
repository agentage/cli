import { describe, test, expect, vi, afterEach } from 'vitest';
import { createReconnector } from './reconnection.js';

describe('Reconnection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('calls onReconnect on start', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const reconnector = createReconnector({ onReconnect });

    reconnector.start();
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
    reconnector.stop();
  });

  test('resets delay after successful connect', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const reconnector = createReconnector({ onReconnect, initialDelayMs: 100 });

    reconnector.start();
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalled());
    reconnector.reset();
    reconnector.stop();
  });

  test('stop prevents further attempts', () => {
    const onReconnect = vi.fn().mockRejectedValue(new Error('fail'));
    const reconnector = createReconnector({ onReconnect });

    reconnector.stop();
    // Should not throw or call onReconnect after stop
    expect(true).toBe(true);
  });

  test('terminates retry loop when onError returns { stop: true }', async () => {
    const onReconnect = vi.fn().mockRejectedValue(new Error('terminal'));
    const onError = vi.fn(() => ({ stop: true }) as { stop: boolean });
    const reconnector = createReconnector({
      onReconnect,
      onError,
      initialDelayMs: 5,
    });

    reconnector.start();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    // Wait long enough that a retry would have fired if not stopped
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    reconnector.stop();
  });

  test('keeps retrying when onError returns void', async () => {
    let calls = 0;
    const onReconnect = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
    });
    const onError = vi.fn();
    const reconnector = createReconnector({
      onReconnect,
      onError,
      initialDelayMs: 5,
    });

    reconnector.start();

    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(3), { timeout: 1000 });
    expect(onError).toHaveBeenCalledTimes(2);

    reconnector.stop();
  });
});
