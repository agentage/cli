import { describe, expect, it } from 'vitest';
import { defaultProfile } from './default-profile.js';
import { parseProfile, toDocument } from './schema.js';

describe('defaultProfile', () => {
  it('is a valid v1 profile with no extensions', () => {
    const doc = toDocument(defaultProfile());
    expect(doc).toEqual({ version: 1, extensions: {}, config: {}, machines: {} });
    expect(parseProfile(doc)).toMatchObject({ ok: true, readOnly: false, warnings: [] });
  });

  it('is a fresh object on every call', () => {
    expect(defaultProfile()).not.toBe(defaultProfile());
  });
});
