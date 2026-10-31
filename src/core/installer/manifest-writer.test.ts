import { describe, expect, it } from 'vitest';
import { MANIFEST_NAME, manifestText, sortedSet } from './manifest-writer.js';

describe('manifestText', () => {
  it('is the same bytes for the same install set in any key order', () => {
    const a = manifestText({ '@agentage/b': '^1', '@agentage/a': '^2' });
    const b = manifestText({ '@agentage/a': '^2', '@agentage/b': '^1' });
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
  });

  it('is private, named, sorted, and has no scripts', () => {
    const doc = JSON.parse(manifestText({ '@agentage/z': '^1', '@agentage/a': '~1.2' })) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
      scripts?: unknown;
    };
    expect(doc).toEqual({
      name: MANIFEST_NAME,
      private: true,
      dependencies: { '@agentage/a': '~1.2', '@agentage/z': '^1' },
    });
    expect(Object.keys(doc.dependencies)).toEqual(['@agentage/a', '@agentage/z']);
  });

  it('writes an empty dependency map for an empty set', () => {
    expect(sortedSet({})).toEqual({});
    expect(JSON.parse(manifestText({}))).toMatchObject({ dependencies: {} });
  });
});
