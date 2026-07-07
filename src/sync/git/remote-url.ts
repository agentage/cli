// Git treats a remote of the form `<helper>::<address>` as a transport helper (`ext::sh -c ...`,
// `fd::...`) and runs it as a command on fetch/push - arbitrary code execution if a poisoned
// vaults.json origin is auto-synced. Only conventional transports are allowed so no origin can
// ever execute code. A leading `-` is also refused (git could read it as an option).
// file:// and absolute local paths are safe transports too (a bare repo on disk/mount); unlike a
// transport helper they cannot run an arbitrary command.
const ALLOWED_SCHEMES = ['https://', 'ssh://', 'git://', 'file://'];

// scp-like short syntax without a scheme: user@host:path.
const SCP_LIKE = /^[^\s/@]+@[^\s/:]+:.+$/;

export const isSafeRemoteUrl = (remote: string): boolean => {
  const url = remote.trim();
  if (!url || url.startsWith('-')) return false;
  const lower = url.toLowerCase();
  if (ALLOWED_SCHEMES.some((s) => lower.startsWith(s))) return true;
  if (url.includes('::')) return false; // transport-helper syntax (ext::, fd::, <helper>::)
  if (url.startsWith('/')) return true; // absolute local path
  return SCP_LIKE.test(url);
};

export const assertSafeRemoteUrl = (remote: string): void => {
  if (!isSafeRemoteUrl(remote))
    throw new Error(
      `unsafe git remote URL ${JSON.stringify(remote.trim())} ` +
        '(allowed: https://, ssh://, git://, file://, user@host:path, or an absolute local path)'
    );
};

// Redact `user:password@host` credentials for display; the stored value is left untouched. A bare
// `user@host` (scp-like, or scheme userinfo without a password) carries no secret and is kept.
export const redactRemoteUrl = (remote: string): string =>
  remote.replace(/(:\/\/[^/@]+?):[^/@]+@/, '$1:***@');
