import { describe, expect, it } from 'vitest';
import { resolveEdit, strReplace } from './memory-edit.js';

describe('strReplace', () => {
  it('replaces a unique occurrence', () => {
    expect(strReplace('alpha beta gamma', 'f.md', 'beta', 'BETA')).toBe('alpha BETA gamma');
  });

  it('deletes the match when new_str is empty', () => {
    expect(strReplace('a b c', 'f.md', 'b ', '')).toBe('a c');
  });

  it('throws the canonical error when old_str is absent', () => {
    expect(() => strReplace('abc', 'f.md', 'xyz', 'q')).toThrow(
      /No replacement was performed, old_str `xyz` did not appear verbatim in f\.md\./
    );
  });

  it('throws the canonical error (with lines) on multiple occurrences', () => {
    expect(() => strReplace('a\na', 'f.md', 'a', 'X')).toThrow(
      /Multiple occurrences of old_str `a` in f\.md \(lines: 1, 2\)\. Please ensure it is unique\./
    );
  });
});

describe('resolveEdit', () => {
  it('applies a str_replace', () => {
    expect(resolveEdit('a b', { path: 'f', oldStr: 'b', newStr: 'X' })).toBe('a X');
  });

  it('appends with a newline guard', () => {
    expect(resolveEdit('x', { path: 'f', body: 'more', mode: 'append' })).toBe('x\nmore');
    expect(resolveEdit('x\n', { path: 'f', body: 'more', mode: 'append' })).toBe('x\nmore');
  });

  it('replaces the whole body', () => {
    expect(resolveEdit('old', { path: 'f', body: 'new' })).toBe('new');
  });

  it('rejects combining str_replace with a body', () => {
    expect(() => resolveEdit('x', { path: 'f', oldStr: 'x', body: 'y' })).toThrow(/cannot combine/);
  });

  it('rejects an edit with neither --old nor --body', () => {
    expect(() => resolveEdit('x', { path: 'f' })).toThrow(/either --old.*or --body/);
  });
});
