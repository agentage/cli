import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IGNORE,
  firstFive,
  globToRegex,
  isIgnored,
  parseIgnore,
} from './release-ignore.js';

const defaults = parseIgnore(DEFAULT_IGNORE.join('\n'));

describe('release ignore patterns', () => {
  it('a pattern with no slash matches at any depth; one with a slash is anchored', () => {
    expect(globToRegex('*.md').test('docs/deep/a.md')).toBe(true);
    expect(globToRegex('docs/**').test('docs/a/b.txt')).toBe(true);
    expect(globToRegex('docs/**').test('src/docs/a.txt')).toBe(false);
    expect(globToRegex('/notes.txt').test('notes.txt')).toBe(true);
    expect(globToRegex('a/**/b.txt').test('a/x/y/b.txt')).toBe(true);
    expect(globToRegex('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegex('a+b.txt').test('aab.txt')).toBe(false);
  });

  it('the defaults ignore root docs, markdown, CI and repo config, nothing deeper', () => {
    for (const path of [
      'docs/guide.txt',
      'README.md',
      '.github/workflows/release.yml',
      '.repo-doctor.yml',
      '.gitignore',
      '.prettierrc.json',
      '.editorconfig',
      'LICENSE',
    ])
      expect(isIgnored(defaults, path), path).toBe(true);
    const deeper = ['site/src/content/x.md', 'site/public/README.md', 'sub/docs/a.md', 'a/LICENSE'];
    for (const path of ['index.js', 'dist-config.yml', 'scripts/x.sh', ...deeper])
      expect(isIgnored(defaults, path), path).toBe(false);
  });

  it('a folder name with no slash ignores what is under it; ! re-includes; the last rule wins', () => {
    const rules = parseIgnore(['# a comment', '', 'fixtures', '!fixtures/keep.json'].join('\n'));
    expect(isIgnored(rules, 'fixtures/a.json')).toBe(true);
    expect(isIgnored(rules, 'fixtures/keep.json')).toBe(false);
    expect(isIgnored(parseIgnore('*.md\n!README.md'), 'README.md')).toBe(false);
  });

  it('what goes into the image always counts, whatever a pattern says', () => {
    const all = parseIgnore('*\n**\nsrc/**\npackage*.json\nDockerfile*');
    for (const path of ['package.json', 'package-lock.json', 'src/a.ts', 'src/docs/a.md'])
      expect(isIgnored(all, path), path).toBe(false);
    expect(isIgnored(all, 'Dockerfile.container')).toBe(false);
    expect(isIgnored(all, 'docs/package.json')).toBe(true);
  });

  it('names the first five files, then how many more', () => {
    expect(firstFive(['a', 'b'])).toBe('a, b');
    expect(firstFive(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e and 2 more');
  });
});
