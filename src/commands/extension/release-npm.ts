import type { ExtensionPackage } from '@agentage/extension/tool';
import type { Exec } from './release-guard.js';
import { step } from './release-steps.js';

// The kit refuses unknown keys under `agentage`: the opt-in is a top-level package.json key.
export const OPT_IN = 'agentagePublishFromPrivateRepo';

export const amber = (line: string): void => console.log(`AMBER ${line}`);

const optedIn = (pkg: ExtensionPackage): boolean => {
  const config = pkg['publishConfig'] as { access?: unknown } | undefined;
  return config?.access === 'public' && pkg[OPT_IN] === true;
};

const howTo = `set publishConfig.access to "public" and ${OPT_IN} to true to publish it`;

// Default deny: only a repo GitHub names public, or an explicit opt-in, goes to public npm.
export const npmRefusal = async (
  run: Exec,
  repo: string,
  pkg: ExtensionPackage
): Promise<string | undefined> => {
  const read = await run('gh', ['api', `repos/${repo}`, '--jq', '.private']);
  const answer = read.out.trim();
  if (read.ok && answer === 'false') return undefined;
  if (!read.ok || answer !== 'true')
    return `cannot read whether ${repo} is private (${read.err || answer || 'no answer'}): npm skipped`;
  if (!optedIn(pkg)) return `${repo} is a private repo: npm skipped; ${howTo}`;
  step(`npm: ${repo} is private, ${pkg.name} opts in to public npm`);
  return undefined;
};
