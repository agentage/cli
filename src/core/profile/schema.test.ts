import { describe, expect, it } from 'vitest';
import { parseProfile, toDocument, type ProfileParse } from './schema.js';

const HELLO = '@agentage/fixture-hello';
const WORLD = '@agentage/fixture-world';

const errorsOf = (result: ProfileParse): string[] => (result.ok ? [] : result.errors);

const withVersion = (spec: unknown) => ({ version: 1, extensions: { [HELLO]: spec } });

const withRegistry = (url: unknown, scope = '@acme') => ({
  version: 1,
  registries: { [scope]: url },
});

describe('a profile (schema v1)', () => {
  it('names extensions by package and version; registries, config and machines are optional', () => {
    const doc = {
      version: 1,
      extensions: { [HELLO]: '^1.0.0', [WORLD]: '^1' },
      registries: { '@agentage': 'https://registry.npmjs.org' },
      config: { hello: { greeting: 'hi' } },
      machines: { m_8f2a91c0: { off: [WORLD], config: { hello: { a: 1 } } } },
    };
    const result = parseProfile(doc);
    expect(result).toMatchObject({ ok: true, readOnly: false, warnings: [] });
    expect(result.ok && toDocument(result.profile)).toEqual(doc);
    const bare = parseProfile({ version: 1 });
    expect(bare.ok && toDocument(bare.profile)).toEqual({
      version: 1,
      extensions: {},
      config: {},
      machines: {},
    });
  });

  it.each(['^1', '~1.2.3', '1.x', '>=1 <2', '*', 'https://example.com/x-1.0.0.tgz'])(
    'accepts %j as a version: a semver range or an https: tarball URL',
    (spec) => {
      expect(errorsOf(parseProfile(withVersion(spec)))).toEqual([]);
    }
  );

  it.each([
    ['file:../x', 'file: specs are refused; use a semver range or an https: tarball URL'],
    ['npm:@agentage/y@1', 'npm: specs are refused'],
    ['github:agentage/x', 'github: specs are refused'],
    ['http://example.com/x.tgz', 'http: specs are refused'],
    ['https://127.0.0.1/x.tgz', 'loopback URLs are refused'],
    ['https://[::1]/x.tgz', 'loopback URLs are refused'],
    ['https://', 'is not a valid https: URL'],
    ['./extensions/x', 'local paths are dev-only and belong in machine.json'],
    ['~/x', 'local paths are dev-only'],
    ['git+ssh://host/x.git', 'unsupported spec'],
    ['latest', 'is not a semver range'],
    ['', 'must be a non-empty string'],
    [2, 'must be a non-empty string'],
  ])('refuses %j as a version, naming the extension', (spec, message) => {
    const [error] = errorsOf(parseProfile(withVersion(spec)));
    expect(error).toContain(`extensions["${HELLO}"]: ${message}`);
  });

  it('refuses a package name npm would not accept', () => {
    const doc = { version: 1, extensions: { 'Bad Name': '^1' } };
    expect(errorsOf(parseProfile(doc))).toEqual([
      'extensions["Bad Name"]: is not a valid package name',
    ]);
  });

  it.each(['https://npm.acme.example', 'http://127.0.0.1:4873', 'http://localhost:4873/npm/'])(
    'sends a scope to %j: an https: registry, or http: on a loopback host',
    (url) => {
      expect(errorsOf(parseProfile(withRegistry(url)))).toEqual([]);
    }
  );

  it.each([
    'http://npm.acme.example',
    'ftp://npm.acme.example',
    'https://',
    'https://npm.acme.example/\n@x:registry=https://evil.example',
    3,
  ])('refuses %j as a registry, naming registries["@acme"]', (url) => {
    expect(errorsOf(parseProfile(withRegistry(url)))).toEqual([
      'registries["@acme"]: must be an https: URL, or http: on a loopback host',
    ]);
  });

  it('refuses a registry URL that carries credentials: they would land in the tree', () => {
    expect(errorsOf(parseProfile(withRegistry('https://user:secret@npm.acme.example')))).toEqual([
      'registries["@acme"]: must not carry credentials',
    ]);
  });

  it('keys registries by npm scope only', () => {
    expect(errorsOf(parseProfile(withRegistry('https://r.example', 'acme')))).toEqual([
      'registries["acme"]: is not an npm scope (@name)',
    ]);
    expect(errorsOf(parseProfile({ version: 1, registries: [] }))).toEqual([
      'registries: must be an object',
    ]);
  });

  it('reports every malformed section with its path', () => {
    const doc = {
      version: 1,
      extensions: [],
      config: { hello: 'x' },
      machines: { m_1: { off: 'world', config: { hello: [] } }, m_2: 3, m_3: { config: 2 } },
    };
    expect(errorsOf(parseProfile(doc))).toEqual([
      'extensions: must be an object',
      'config["hello"]: must be an object',
      'machines["m_1"].off: must be an array of package names',
      'machines["m_1"].config["hello"]: must be an object',
      'machines["m_2"]: must be an object',
      'machines["m_3"].config: must be an object',
    ]);
    expect(errorsOf(parseProfile({ version: 1, config: 1, machines: [] }))).toEqual([
      'config: must be an object',
      'machines: must be an object',
    ]);
  });

  it.each([[undefined], ['1'], [0], [1.5]])('needs version 1, refusing %j', (version) => {
    expect(errorsOf(parseProfile({ version }))[0]).toMatch(/^version: must be 1 \(got /);
  });

  it('must be a JSON object', () => {
    expect(errorsOf(parseProfile([]))).toEqual(['profile.json: must be a JSON object']);
  });

  it('from a newer schema is read-only, with a warning', () => {
    const result = parseProfile({ version: 2, extensions: { [HELLO]: '^1' } });
    expect(result).toMatchObject({ ok: true, readOnly: true });
    expect(result.ok && result.warnings[0]).toContain('version: 2 is newer');
  });

  it('keeps keys this CLI does not know, with a warning, and writes them back', () => {
    const doc = { version: 1, extensions: {}, teams: ['a'], machines: { m: { off: [], pin: 1 } } };
    const result = parseProfile(doc);
    expect(result.ok && result.warnings).toEqual([
      'machines["m"]: unknown key "pin" kept',
      'profile.json: unknown key "teams" kept',
    ]);
    expect(result.ok && toDocument(result.profile)).toEqual({
      ...doc,
      config: {},
      machines: { m: { off: [], config: {}, pin: 1 } },
    });
  });
});
