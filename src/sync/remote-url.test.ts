import { describe, expect, it } from 'vitest';
import { assertSafeRemoteUrl, isSafeRemoteUrl, redactRemoteUrl } from './remote-url.js';

describe('isSafeRemoteUrl', () => {
  it('allows conventional transports', () => {
    expect(isSafeRemoteUrl('https://github.com/me/repo.git')).toBe(true);
    expect(isSafeRemoteUrl('ssh://git@host/me/repo.git')).toBe(true);
    expect(isSafeRemoteUrl('git://host/me/repo.git')).toBe(true);
    expect(isSafeRemoteUrl('  https://host/repo.git  ')).toBe(true);
  });

  it('allows scp-like user@host:path', () => {
    expect(isSafeRemoteUrl('git@github.com:me/repo.git')).toBe(true);
    expect(isSafeRemoteUrl('user@host:path/to/repo')).toBe(true);
  });

  it('allows credentialed https (redaction handles display)', () => {
    expect(isSafeRemoteUrl('https://user:token@host/repo.git')).toBe(true);
  });

  it('rejects transport-helper URLs (arbitrary command execution)', () => {
    expect(isSafeRemoteUrl('ext::sh -c "id"')).toBe(false);
    expect(isSafeRemoteUrl('fd::17')).toBe(false);
    expect(isSafeRemoteUrl('transport::address')).toBe(false);
    expect(isSafeRemoteUrl('user@host::ext')).toBe(false);
  });

  it('rejects a URL that could be read as a git option', () => {
    expect(isSafeRemoteUrl('-oProxyCommand=evil')).toBe(false);
  });

  it('allows local file transports (no command execution)', () => {
    expect(isSafeRemoteUrl('/srv/git/repo.git')).toBe(true);
    expect(isSafeRemoteUrl('file:///srv/git/repo.git')).toBe(true);
  });

  it('rejects blank and non-transport strings', () => {
    expect(isSafeRemoteUrl('')).toBe(false);
    expect(isSafeRemoteUrl('   ')).toBe(false);
    expect(isSafeRemoteUrl('C:\\repo')).toBe(false);
  });
});

describe('assertSafeRemoteUrl', () => {
  it('passes a safe URL and throws on an unsafe one', () => {
    expect(() => assertSafeRemoteUrl('git@host:me/r.git')).not.toThrow();
    expect(() => assertSafeRemoteUrl('ext::sh -c "id"')).toThrow('unsafe git remote URL');
  });
});

describe('redactRemoteUrl', () => {
  it('redacts the password in a credentialed URL, keeping the user', () => {
    expect(redactRemoteUrl('https://user:token@host/repo.git')).toBe(
      'https://user:***@host/repo.git'
    );
    expect(redactRemoteUrl('ssh://git:secret@host/repo')).toBe('ssh://git:***@host/repo');
  });

  it('leaves credential-free remotes untouched', () => {
    expect(redactRemoteUrl('https://host/repo.git')).toBe('https://host/repo.git');
    expect(redactRemoteUrl('git@host:me/r.git')).toBe('git@host:me/r.git');
  });
});
