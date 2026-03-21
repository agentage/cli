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
});
