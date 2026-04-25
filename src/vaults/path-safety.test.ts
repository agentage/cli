import { describe, expect, it } from 'vitest';
import { safeJoin } from './path-safety.js';

describe('safeJoin', () => {
  it('joins vault path with relative subpath', () => {
    expect(safeJoin('/vault', 'notes/a.md')).toBe('/vault/notes/a.md');
  });

  it('rejects absolute paths', () => {
    expect(() => safeJoin('/vault', '/etc/passwd')).toThrow(/absolute/);
  });

  it('rejects paths that escape via ..', () => {
    expect(() => safeJoin('/vault', '../etc/passwd')).toThrow(/escapes/);
    expect(() => safeJoin('/vault', 'notes/../../etc/passwd')).toThrow(/escapes/);
  });

  it('allows .. that stays within the vault', () => {
    expect(safeJoin('/vault', 'a/../b.md')).toBe('/vault/b.md');
  });

  it('handles trailing slashes on vault path', () => {
    expect(safeJoin('/vault/', 'a.md')).toBe('/vault/a.md');
  });
});
