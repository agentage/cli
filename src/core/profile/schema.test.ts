import { describe, expect, it } from 'vitest';
import { parseProfile, specProblem, toDocument, type ProfileParse } from './schema.js';

const two = {
  version: 1,
  plugins: { '@agentage/fixture-hello': '^1.0.0', '@agentage/fixture-world': '^1.0.0' },
  config: { hello: { greeting: 'hi' } },
  machines: { m_8f2a91c0: { off: ['@agentage/fixture-world'], config: { hello: { a: 1 } } } },
};

const errorsOf = (result: ProfileParse): string[] => (result.ok ? [] : result.errors);

const withPlugin = (spec: unknown, name = '@agentage/x') => ({
  version: 1,
  plugins: { [name]: spec },
});

describe('parseProfile (schema v1)', () => {
  it('parses a valid profile', () => {
    const result = parseProfile(two);
    expect(result).toEqual({
      ok: true,
      readOnly: false,
      warnings: [],
      profile: {
        ...two,
        machines: { m_8f2a91c0: { ...two.machines.m_8f2a91c0, extra: {} } },
        extra: {},
      },
    });
  });

  it('defaults absent sections to empty maps', () => {
    const result = parseProfile({ version: 1 });
    expect(result.ok && result.profile).toMatchObject({ plugins: {}, config: {}, machines: {} });
  });

  it('accepts https tarball URLs and semver ranges', () => {
    for (const spec of ['https://example.com/x-1.0.0.tgz', '^1', '~1.2.3', '1.x', '>=1 <2', '*'])
      expect(errorsOf(parseProfile(withPlugin(spec))), spec).toEqual([]);
  });

  it.each([
    ['file:../x', 'file: specs are refused'],
    ['npm:@agentage/y@1', 'npm: specs are refused'],
    ['github:agentage/x', 'github: specs are refused'],
    ['http://example.com/x.tgz', 'http: specs are refused'],
    ['https://127.0.0.1/x.tgz', 'loopback URLs are refused'],
    ['https://localhost:8080/x.tgz', 'loopback URLs are refused'],
    ['https://[::1]/x.tgz', 'loopback URLs are refused'],
    ['https://', 'is not a valid https: URL'],
    ['./plugins/x', 'local paths are dev-only'],
    ['/abs/x', 'local paths are dev-only'],
    ['~/x', 'local paths are dev-only'],
    ['git+ssh://host/x.git', 'unsupported spec'],
    ['agentage/x', 'is not a semver range'],
    ['latest', 'is not a semver range'],
    ['', 'must be a non-empty string'],
    [2, 'must be a non-empty string'],
  ])('refuses %j naming the path', (spec, message) => {
    const [error] = errorsOf(parseProfile(withPlugin(spec)));
    expect(error).toContain('plugins["@agentage/x"]');
    expect(error).toContain(message);
  });

  it('refuses an invalid package name', () => {
    expect(errorsOf(parseProfile(withPlugin('^1', 'Bad Name')))).toEqual([
      'plugins["Bad Name"]: is not a valid package name',
    ]);
  });

  it('names the path of every malformed section', () => {
    const errors = errorsOf(
      parseProfile({
        version: 1,
        plugins: [],
        config: { hello: 'x' },
        machines: { m_1: { off: 'world', config: { hello: [] } }, m_2: 3 },
      })
    );
    expect(errors).toEqual([
      'plugins: must be an object',
      'config["hello"]: must be an object',
      'machines["m_1"].off: must be an array of package names',
      'machines["m_1"].config["hello"]: must be an object',
      'machines["m_2"]: must be an object',
    ]);
  });

  it('refuses non-object config and machines sections', () => {
    expect(errorsOf(parseProfile({ version: 1, config: 1, machines: [] }))).toEqual([
      'config: must be an object',
      'machines: must be an object',
    ]);
    expect(errorsOf(parseProfile({ version: 1, machines: { m: { config: 2 } } }))).toEqual([
      'machines["m"].config: must be an object',
    ]);
  });

  it.each([[undefined], ['1'], [0], [1.5]])('requires an integer version, got %j', (version) => {
    const [error] = errorsOf(parseProfile({ version }));
    expect(error).toMatch(/^version: must be 1 \(got /);
  });

  it('refuses a document that is not an object', () => {
    expect(errorsOf(parseProfile([]))).toEqual(['profile.json: must be a JSON object']);
  });

  it('reads a higher major as read-only with a warning', () => {
    const result = parseProfile({ version: 2, plugins: { '@agentage/x': '^1' } });
    expect(result.ok && result.readOnly).toBe(true);
    expect(result.ok && result.warnings[0]).toContain('version: 2 is newer');
  });

  it('keeps unknown keys with a warning and writes them back on round-trip', () => {
    const doc = { ...two, teams: ['a'], machines: { m: { off: [], pinned: true } } };
    const result = parseProfile(doc);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.warnings).toEqual([
      'machines["m"]: unknown key "pinned" kept',
      'profile.json: unknown key "teams" kept',
    ]);
    expect(toDocument(result.profile)).toEqual({
      ...doc,
      machines: { m: { off: [], config: {}, pinned: true } },
    });
  });

  it('exposes the spec rule on its own', () => {
    expect(specProblem('^1.2.3')).toBeNull();
    expect(specProblem('FILE:x')).toContain('file: specs are refused');
  });
});
