import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotPushedError } from '../core/profile/cloud.js';
import { AuthRequiredError, TransientAuthError } from './auth/auth-errors.js';
import { TokenRequestError } from './auth/oauth.js';
import {
  CliError,
  CODES,
  codeOf,
  DaemonError,
  isJsonRun,
  messageOf,
  runJson,
} from './json-output.js';

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

  it("list each code the cli's installer sends through the daemon, the market ones in upper case", () => {
    const text = readFileSync(REFERENCE, 'utf8');
    const source = readFileSync(
      join(import.meta.dirname, '../commands/daemon/installer.ts'),
      'utf8'
    );
    const sent = [...source.matchAll(/installError\('([A-Z_]+)'/g)].map((m) => m[1]);
    const market = CODES.filter((c) => /market|discovery/.test(c)).map((c) => c.toUpperCase());
    for (const code of [...sent, ...market]) expect(text, code).toContain(`\`${code}\``);
  });
});

describe('expected failures of the system', () => {
  const errno = (code: string, message: string) => Object.assign(new Error(message), { code });

  it.each([
    ['EACCES', 'permission_denied'],
    ['EPERM', 'permission_denied'],
    ['EROFS', 'permission_denied'],
    ['ENOSPC', 'disk_full'],
    ['EDQUOT', 'disk_full'],
  ])('%s is %s', (code, want) => {
    expect(codeOf(errno(code, `${code}: no, open '/x'`))).toBe(want);
  });

  it('fetch failed is network_unavailable, with the host and the reason on one line', () => {
    const cause = errno('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:1');
    const err = new TypeError('fetch failed', { cause });
    expect(codeOf(err)).toBe('network_unavailable');
    expect(messageOf(err)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:1');
  });

  it('a timed-out call is timeout', () => {
    const err = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    expect(codeOf(err)).toBe('timeout');
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
