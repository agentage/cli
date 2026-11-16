import { isVersionSpec } from '../../core/installer/version-spec.js';
import { kitIdProblem } from '../../core/kit-id.js';
import { CliError } from '../../lib/json-output.js';

const ID = /^[a-z][a-z0-9-]*$/;
const PACKAGE_PREFIX = /^(@agentage\/extension-|agentage-extension-)/;
export const UNSCOPED = 'agentage-extension-';

// The daemon takes an id, not a package name: with a market it resolves only the scoped name.
export const unscoped = (name: string): CliError =>
  new CliError(
    'invalid_argument',
    `${name}: an unscoped npm name installs only on a site with no market; nothing installed; install its folder instead: agentage extension install ./<folder>`
  );

// What 0.51 installed and the daemon does not: say what to type instead.
const refusedName = (name: string): string | null => {
  if (/^https?:\/\//i.test(name))
    return `${name}: a tarball URL no longer installs; unpack it, then agentage extension install ./<folder>`;
  if (name.startsWith('@') && !PACKAGE_PREFIX.test(name))
    return `${name}: only @agentage/extension-<id> packages install, by id; for another package, install its folder (./path)`;
  return null;
};

// `probe`, `probe@0.6.2`, or a package name of the id.
export const specOf = (name: string): { id: string; version?: string } => {
  const refused = refusedName(name);
  if (refused) throw new CliError('invalid_argument', refused);
  const at = name.indexOf('@', 1);
  const id = (at < 0 ? name : name.slice(0, at)).replace(PACKAGE_PREFIX, '');
  const version = at < 0 ? undefined : name.slice(at + 1);
  if (!ID.test(id) || version === '')
    throw new CliError('invalid_argument', `${name}: not an id, id@version or a folder (./path)`);
  if (version !== undefined && !isVersionSpec(version))
    throw new CliError(
      'invalid_argument',
      `${name}: after @ only a version, a range or a dist-tag`
    );
  const owned = kitIdProblem(id);
  if (owned) throw new CliError('invalid_argument', `${name}: ${owned}`);
  return { id, ...(version && { version }) };
};
