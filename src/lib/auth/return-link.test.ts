import { describe, expect, it } from 'vitest';
import { returnLinkOf, SIGN_IN_RETURN_ENV } from './return-link.js';

const of = (value?: string) =>
  returnLinkOf(value === undefined ? {} : { [SIGN_IN_RETURN_ENV]: value });

describe('returnLinkOf', () => {
  it('names the one desktop deep link', () => {
    expect(of('desktop')).toBe('agentage://signed-in');
  });

  it('is none for unset, empty and unknown values', () => {
    for (const value of [undefined, '', 'Desktop', 'agentage://evil', 'https://x.test'])
      expect(of(value)).toBeUndefined();
  });

  it('never takes a prototype key as a link', () => {
    for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
      expect(of(value)).toBeUndefined();
  });
});
