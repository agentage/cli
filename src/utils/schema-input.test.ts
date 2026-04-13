import { describe, it, expect } from 'vitest';
import { mergeInputs, parseInputJson, validateInput } from './schema-input.js';

describe('parseInputJson', () => {
  it('parses an object', () => {
    expect(parseInputJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('rejects a non-object', () => {
    expect(() => parseInputJson('42')).toThrow(/must be a JSON object/);
    expect(() => parseInputJson('[1,2]')).toThrow(/must be a JSON object/);
    expect(() => parseInputJson('null')).toThrow(/must be a JSON object/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseInputJson('{bad')).toThrow();
  });
});

describe('mergeInputs', () => {
  it('merges in order, later wins', () => {
    expect(mergeInputs({ a: 1, b: 2 }, { b: 3 }, { c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('skips undefined layers', () => {
    expect(mergeInputs(undefined, { a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe('validateInput', () => {
  const schema = {
    type: 'object',
    properties: {
      prUrl: { type: 'string', format: 'uri' },
      count: { type: 'number', default: 5 },
      drafts: { type: 'boolean' },
    },
    required: ['prUrl'],
    additionalProperties: false,
  };

  it('accepts valid input and applies defaults', () => {
    const res = validateInput(schema, { prUrl: 'https://x' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ prUrl: 'https://x', count: 5 });
  });

  it('coerces string to number when schema says number', () => {
    const res = validateInput(schema, { prUrl: 'https://x', count: '7' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.count).toBe(7);
  });

  it('rejects missing required field', () => {
    const res = validateInput(schema, {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/prUrl/);
  });

  it('rejects unknown property', () => {
    const res = validateInput(schema, { prUrl: 'https://x', extra: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/extra|additional/i);
  });

  it('returns error for malformed schema', () => {
    const bad = { type: 'nope' } as Record<string, unknown>;
    const res = validateInput(bad, {});
    expect(res.ok).toBe(false);
  });
});
