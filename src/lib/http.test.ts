import { describe, expect, it } from 'vitest';
import { fetchJsonUnref } from './http.js';

describe('fetchJsonUnref', () => {
  it('resolves null within the timeout bound on an unreachable host', async () => {
    const started = Date.now();
    // 192.0.2.1 (TEST-NET-1) either blackholes (the destroy timer fires) or refuses fast.
    const result = await fetchJsonUnref('https://192.0.2.1/x', 500);
    expect(result).toBeNull();
    // Generous CI bound (timers stretch under load); still well under undici's ~10s floor.
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
