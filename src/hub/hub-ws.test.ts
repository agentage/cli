import { describe, test, expect } from 'vitest';
import { createHubWs } from './hub-ws.js';

describe('HubWs', () => {
  test('creates without error', () => {
    const hubWs = createHubWs('http://localhost:3001', 'test-token', 'machine-1');
    expect(hubWs).toBeDefined();
    expect(hubWs.isConnected()).toBe(false);
  });

  test('disconnect is safe when not connected', () => {
    const hubWs = createHubWs('http://localhost:3001', 'test-token', 'machine-1');
    expect(() => hubWs.disconnect()).not.toThrow();
  });
});
