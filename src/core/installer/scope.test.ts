import { describe, expect, it } from 'vitest';
import { allowedScopes, CORE_SCOPES, installSetProblems, scopeProblem } from './scope.js';

describe('scope rule (R10)', () => {
  it('allows only @agentage unless AGENTAGE_PLUGIN_SCOPES widens it', () => {
    expect(allowedScopes({})).toEqual([...CORE_SCOPES]);
    expect(allowedScopes({ AGENTAGE_PLUGIN_SCOPES: ' acme, @beta ,,@agentage' })).toEqual([
      '@agentage',
      '@acme',
      '@beta',
    ]);
  });

  it('refuses unscoped names and other scopes, naming the rule', () => {
    expect(scopeProblem('@agentage/plugin-hub', ['@agentage'])).toBeNull();
    for (const name of ['left-pad', '@acme/plugin', '@agentage', '@agentagex/plugin']) {
      expect(scopeProblem(name, ['@agentage']), name).toBe(
        'refused by the scope rule: only @agentage packages are installed ' +
          '(AGENTAGE_PLUGIN_SCOPES widens it)'
      );
    }
    expect(scopeProblem('@acme/plugin', ['@agentage', '@acme'])).toBeNull();
  });

  it('lists every refused plugin with its path, scope first, then the spec rule', () => {
    const problems = installSetProblems(
      {
        '@agentage/fixture-hello': '^1.0.0',
        '@acme/fixture-hello': '^1.0.0',
        '@agentage/fixture-world': 'file:../world',
        '@agentage/fixture-x': 'npm:other@1',
      },
      ['@agentage']
    );
    expect(problems).toEqual([
      'plugins["@acme/fixture-hello"]: refused by the scope rule: only @agentage packages ' +
        'are installed (AGENTAGE_PLUGIN_SCOPES widens it)',
      'plugins["@agentage/fixture-world"]: file: specs are refused; use a semver range or an ' +
        'https: tarball URL',
      'plugins["@agentage/fixture-x"]: npm: specs are refused; use a semver range or an https: ' +
        'tarball URL',
    ]);
  });
});
