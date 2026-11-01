import { realpathSync, symlinkSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect } from 'vitest';
import { fixture, test } from '../../test/config-dir.js';
import { manifestFromFixtures, type Publishes } from '../../test/npm-fixtures.js';
import { type NpmManifest } from './npm.js';
import { candidatesFor, registryLookup, resolveName, type Registry } from './resolve.js';

// npm answers from the fixtures, plus whatever else a test publishes.
const published = (more: Publishes = {}): Registry =>
  registryLookup(manifestFromFixtures(more), {});

const asked = async (spec: string): Promise<never> => {
  throw new Error(`npm asked about ${spec}`);
};
const neverAsked: Registry = { find: asked, versions: asked };

const HELLO = '@agentage/fixture-hello';
const NEEDS_2 = { engines: { agentage: '^2' } };

const HELLO_URL = 'https://registry.example/@agentage/fixture-hello/-/fixture-hello-1.0.0.tgz';

describe('extension install <name>: what a name resolves to', () => {
  test('a short name is @agentage/extension-<name> first, then agentage-extension-<name>', async () => {
    const both = published({
      '@agentage/extension-memory': { '1.2.0': {} },
      'agentage-extension-memory': { '3.0.0': {} },
    });
    expect(await resolveName('memory', both)).toEqual({
      kind: 'package',
      name: '@agentage/extension-memory',
      spec: '^1.2.0',
      skipped: [],
    });
    expect(
      await resolveName('memory', published({ 'agentage-extension-memory': { '3.0.0': {} } }))
    ).toEqual({
      kind: 'package',
      name: 'agentage-extension-memory',
      spec: '^3.0.0',
      skipped: [],
    });
  });

  test('a short name the registry has under neither candidate fails naming both', async () => {
    await expect(resolveName('memory', published())).rejects.toThrow(
      'memory: not found; tried @agentage/extension-memory, agentage-extension-memory'
    );
  });

  test('a package name is used as written, pinned to ^ its latest version unless a range is given', async () => {
    expect(await resolveName('@agentage/fixture-hello', published())).toEqual({
      kind: 'package',
      name: '@agentage/fixture-hello',
      spec: '^1.0.0',
      skipped: [],
    });
    expect(await resolveName('@agentage/fixture-hello@~1.0', published())).toMatchObject({
      spec: '~1.0',
    });
    expect(candidatesFor('agentage-extension-memory')).toEqual(['agentage-extension-memory']);
  });

  test('a range no version satisfies stops with npm\'s own lines, not "not found"', async () => {
    await expect(resolveName('@agentage/fixture-hello@^2', published())).rejects.toThrow(
      /^npm could not read @agentage\/fixture-hello@\^2 \(exit 1\)\nnpm error code ETARGET/
    );
  });

  test('an https: tarball URL is kept as written, under the name its package declares', async () => {
    expect(await resolveName(HELLO_URL, published())).toEqual({
      kind: 'package',
      name: '@agentage/fixture-hello',
      spec: HELLO_URL,
      skipped: [],
    });
  });

  test('without a range: the newest version whose engines.agentage fits the extension API, naming each newer one skipped', async () => {
    const newer = published({ [HELLO]: { '1.0.1': {}, '2.0.0': NEEDS_2, '1.5.0': NEEDS_2 } });
    expect(await resolveName(HELLO, newer)).toEqual({
      kind: 'package',
      name: HELLO,
      spec: '^1.0.1',
      skipped: [
        { version: '2.0.0', engine: '^2' },
        { version: '1.5.0', engine: '^2' },
      ],
    });
  });

  test('with a range: the range as typed, whatever the engines of the versions in it', async () => {
    const newer = published({ [HELLO]: { '1.5.0': NEEDS_2 } });
    expect(await resolveName(`${HELLO}@^1`, newer)).toMatchObject({ spec: '^1', skipped: [] });
  });

  test('when no published version fits the extension API, it fails naming the newest and what it needs', async () => {
    const only = published({ '@agentage/extension-memory': { '2.0.0': NEEDS_2 } });
    await expect(resolveName('memory', only)).rejects.toThrow(
      'memory: no published version works with extension API 1.0.0 (2.0.0: needs extension API ^2)'
    );
  });

  test('a local path is a dev extension: its real path and the name its package.json declares', async ({
    dir,
  }) => {
    const link = dir.at('linked-hello');
    dir.write('.keep', '');
    symlinkSync(fixture('hello'), link);
    const expected = {
      kind: 'dev',
      name: '@agentage/fixture-hello',
      path: realpathSync(fixture('hello')),
    };
    expect(await resolveName(link, neverAsked)).toEqual(expected);
    expect(await resolveName(`./${relative(process.cwd(), fixture('hello'))}`, neverAsked)).toEqual(
      expected
    );
  });

  test('a local path without a package.json naming agentage.id is refused', async ({ dir }) => {
    dir.write('plain/package.json', { name: 'plain', version: '1.0.0' });
    await expect(resolveName(dir.at('plain'), neverAsked)).rejects.toThrow(
      `${dir.at('plain')}: not an extension folder (no package.json with a name and agentage.id)`
    );
    await expect(resolveName('./no/such/folder', neverAsked)).rejects.toThrow(
      './no/such/folder: not an extension folder'
    );
  });

  test.for([
    ['http://x/y.tgz', 'http: is refused'],
    ['file:../x', 'file: is refused'],
    ['npm:x', 'npm: is refused'],
    ['github:a/b', 'github: is refused'],
    ['git+ssh://h/x.git', 'unsupported'],
  ])('%s is refused naming the rule, without asking npm', async ([input, rule]) => {
    await expect(resolveName(input ?? '', neverAsked)).rejects.toThrow(
      `${input}: ${rule}; install a package name, an https: tarball URL or a local path (./path)`
    );
  });

  test.for([
    ['Not A Name', 'Not A Name: not a package name'],
    ['@agentage/fixture-hello@latest', '@agentage/fixture-hello@latest: is not a semver range'],
    [
      '@agentage/fixture-hello@file:../x',
      '@agentage/fixture-hello@file:../x: file: specs are refused',
    ],
    ['https://127.0.0.1/x.tgz', 'https://127.0.0.1/x.tgz: loopback URLs are refused'],
  ])('%s cannot go into profile.json, so npm is never asked', async ([input, message]) => {
    await expect(resolveName(input ?? '', neverAsked)).rejects.toThrow(message);
  });
});

describe('the registry lookup', () => {
  test('asks npm once it is first needed, sending each profile scope to its registry', async () => {
    const questions: string[] = [];
    let prepared = 0;
    const manifest = async (): Promise<NpmManifest> => {
      prepared += 1;
      const npm = await manifestFromFixtures()();
      return async (command, spec, registries) => {
        questions.push(`${command} ${spec} via ${JSON.stringify(registries)}`);
        return npm(command, spec, registries);
      };
    };
    const look = registryLookup(manifest, { '@agentage': 'http://127.0.0.1:9' });
    expect(prepared).toBe(0);
    await resolveName('memory', look).catch(() => undefined);
    await resolveName(`${HELLO}@^1`, look);
    expect(prepared).toBe(1);
    expect(questions).toEqual([
      'view @agentage/extension-memory@>=0.0.0 via {"@agentage":"http://127.0.0.1:9"}',
      'view agentage-extension-memory@>=0.0.0 via {"@agentage":"http://127.0.0.1:9"}',
      `pack ${HELLO}@^1 via {"@agentage":"http://127.0.0.1:9"}`,
    ]);
  });

  test('an answer npm printed but did not explain is reported with its output', async () => {
    const odd = async (): Promise<NpmManifest> => async () => ({
      code: 0,
      stdout: 'nope',
      stderr: '',
    });
    await expect(registryLookup(odd, {}).find('x')).rejects.toThrow(
      'npm could not read x (exit 0)\nnope'
    );
    await expect(registryLookup(odd, {}).versions('x')).rejects.toThrow(
      'npm could not read x@>=0.0.0 (exit 0)\nnope'
    );
  });
});
