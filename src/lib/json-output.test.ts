import { describe, expect, it } from 'vitest';
import { NotPushedError } from '../core/profile/cloud.js';
import { AuthRequiredError } from './auth/auth-errors.js';
import { CliError, codeOf, isJsonRun, runJson } from './json-output.js';

describe('codeOf', () => {
  it('uses the CliError code, a known class code, else error', () => {
    expect(codeOf(new CliError('confirmation_required', 'x'))).toBe('confirmation_required');
    expect(codeOf(new AuthRequiredError())).toBe('auth_required');
    expect(codeOf(new NotPushedError('x'))).toBe('not_pushed');
    expect(codeOf(new Error('x'))).toBe('error');
    expect(codeOf('text')).toBe('error');
  });
});

describe('runJson', () => {
  it('marks the run as json while it runs and writes the success envelope', async () => {
    const out: string[] = [];
    let during = false;
    const failure = await runJson({ writeOut: (t) => void out.push(t) }, async () => {
      during = isJsonRun();
      return { a: 1 };
    });
    expect(failure).toBeNull();
    expect(during).toBe(true);
    expect(isJsonRun()).toBe(false);
    expect(out).toEqual(['{"success":true,"data":{"a":1}}\n']);
  });
});
