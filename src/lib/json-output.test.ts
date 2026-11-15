import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotPushedError } from '../core/profile/cloud.js';
import { AuthRequiredError, TransientAuthError } from './auth/auth-errors.js';
import { TokenRequestError } from './auth/oauth.js';
import { CliError, CODES, codeOf, DaemonError, isJsonRun, runJson } from './json-output.js';

const REFERENCE = join(import.meta.dirname, '..', '..', 'docs', 'reference.md');

describe('codeOf', () => {
  it('uses the CliError code, a known class code, else error', () => {
    expect(codeOf(new CliError('confirmation_required', 'x'))).toBe('confirmation_required');
    expect(codeOf(new AuthRequiredError())).toBe('auth_required');
    expect(codeOf(new NotPushedError('x'))).toBe('not_pushed');
    expect(codeOf(new TransientAuthError())).toBe('auth_unavailable');
    expect(codeOf(new TokenRequestError(400))).toBe('token_request_failed');
    expect(codeOf(new DaemonError('not_found', 'x'))).toBe('not_found');
    expect(codeOf(new Error('x'))).toBe('error');
    expect(codeOf('text')).toBe('error');
  });
});

describe('the error codes', () => {
  it('are the list docs/reference.md gives, in the same order', () => {
    const text = readFileSync(REFERENCE, 'utf8');
    const block = /<!-- codes:[^>]*-->([\s\S]*?)<!-- \/codes -->/.exec(text)?.[1] ?? '';
    expect([...block.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])).toEqual([...CODES]);
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
