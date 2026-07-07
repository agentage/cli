import { describe, expect, it } from 'vitest';
import { conflictName } from './conflict.js';

const none = (): boolean => false;

describe('conflictName', () => {
  it('inserts .conflict before the extension', () => {
    expect(conflictName('notes/q.md', none)).toBe('notes/q.conflict.md');
  });

  it('handles a path with no extension', () => {
    expect(conflictName('README', none)).toBe('README.conflict');
  });

  it('does not treat a dot in a folder name as the extension', () => {
    expect(conflictName('a.b/c', none)).toBe('a.b/c.conflict');
  });

  it('does not clobber an existing conflict file - suffixes instead', () => {
    const taken = new Set(['notes/q.conflict.md', 'notes/q.conflict-1.md']);
    expect(conflictName('notes/q.md', (c) => taken.has(c))).toBe('notes/q.conflict-2.md');
  });

  it('leaves a leading-dot filename intact', () => {
    expect(conflictName('.obsidianrc', none)).toBe('.obsidianrc.conflict');
  });
});
