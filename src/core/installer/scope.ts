import { specProblem } from '../profile/schema.js';

// Not profile data: a stolen token cannot widen what this machine installs.
export const CORE_SCOPES: readonly string[] = ['@agentage'];

const asScope = (raw: string): string => (raw.startsWith('@') ? raw : `@${raw}`);

export const allowedScopes = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const extra = (env['AGENTAGE_PLUGIN_SCOPES'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(asScope);
  return [...new Set([...CORE_SCOPES, ...extra])];
};

const scopeOf = (name: string): string | null =>
  name.startsWith('@') && name.includes('/') ? name.slice(0, name.indexOf('/')) : null;

export const scopeProblem = (name: string, scopes: string[]): string | null => {
  const scope = scopeOf(name);
  if (scope !== null && scopes.includes(scope)) return null;
  return (
    `refused by the scope rule: only ${scopes.join(', ')} packages are installed ` +
    '(AGENTAGE_PLUGIN_SCOPES widens it)'
  );
};

// The schema refuses bad specs on read; checked again because an install set can come from code.
export const installSetProblems = (install: Record<string, string>, scopes: string[]): string[] =>
  Object.entries(install).flatMap(([name, spec]) => {
    const problem = scopeProblem(name, scopes) ?? specProblem(spec);
    return problem === null ? [] : [`plugins[${JSON.stringify(name)}]: ${problem}`];
  });
