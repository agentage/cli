// The last hop of a sign-in the desktop started: a fixed allowlist, never a value from a request.
export const SIGN_IN_RETURN_ENV = 'AGENTAGE_SIGN_IN_RETURN';

const RETURNS: Readonly<Record<string, string>> = { desktop: 'agentage://signed-in' };

// Unset, empty or any other value (a prototype key too) is no link: the page keeps its text.
export const returnLinkOf = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const raw = env[SIGN_IN_RETURN_ENV] ?? '';
  return Object.hasOwn(RETURNS, raw) ? RETURNS[raw] : undefined;
};
