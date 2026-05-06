import { describe, expect, it } from 'vitest';
import { platformModule } from './index.js';
import { darwin } from './darwin.js';
import { linux } from './linux.js';
import { win32 } from './win32.js';

describe('platformModule', () => {
  it('returns the linux module on linux', () => {
    expect(platformModule('linux')).toBe(linux);
  });

  it('returns the darwin module on darwin', () => {
    expect(platformModule('darwin')).toBe(darwin);
  });

  it('returns the win32 module on win32', () => {
    expect(platformModule('win32')).toBe(win32);
  });

  it('returns null on unsupported platforms', () => {
    expect(platformModule('aix')).toBeNull();
    expect(platformModule('freebsd')).toBeNull();
  });
});
