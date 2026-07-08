import { describe, expect, it } from 'vitest';
import { formatUptime } from './format.js';

describe('formatUptime', () => {
  it('renders sub-minute uptimes in seconds', () => {
    expect(formatUptime(5)).toBe('5s');
    expect(formatUptime(59)).toBe('59s');
  });

  it('renders minutes and seconds under an hour', () => {
    expect(formatUptime(90)).toBe('1m 30s');
  });

  it('renders hours and minutes past an hour, dropping seconds', () => {
    expect(formatUptime(3720)).toBe('1h 2m');
  });

  it('clamps negatives to zero', () => {
    expect(formatUptime(-10)).toBe('0s');
  });
});
