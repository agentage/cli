/**
 * @offline - the module graph of a cold start: `--version` and `--help` never load the kit host,
 * the core client, express or PGlite; only `daemon run` does. A resolve hook records every module
 * Node loads.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, CLI_BIN } from './helpers.js';

const HEAVY = [
  /@agentage\/extension\/dist\/host\//,
  /@agentage\/extension\/dist\/core-client\//,
  /\/node_modules\/express\//,
  /@electric-sql\/pglite/,
];

const HOOK = `import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) {
  const found = next(spec, ctx);
  appendFileSync(process.env.LOADED_LOG, found.url + '\\n');
  return found;
} });
`;

// Every module URL Node resolved while running `node <args>`.
const loaded = (args: string[]): string[] => {
  const dir = mkdtempSync(join(tmpdir(), 'agentage-graph-'));
  const hook = join(dir, 'hook.mjs');
  const log = join(dir, 'loaded.log');
  writeFileSync(hook, HOOK);
  writeFileSync(log, '');
  const env = { ...process.env, LOADED_LOG: log, AGENTAGE_CONFIG_DIR: dir, NO_COLOR: '1' };
  execFileSync(process.execPath, ['--import', pathToFileURL(hook).href, ...args], { env });
  return readFileSync(log, 'utf8').split('\n').filter(Boolean);
};

test('--version and --help load no kit host, express or PGlite @offline', () => {
  assertCliBuilt();
  for (const flag of ['--version', '--help']) {
    const urls = loaded([CLI_BIN, flag]);
    expect(
      urls.some((url) => url.includes('/commander/')),
      flag
    ).toBe(true);
    for (const heavy of HEAVY)
      expect(
        urls.filter((url) => heavy.test(url)),
        flag
      ).toEqual([]);
  }
});

test('the hook sees the kit host when something does load it @offline', () => {
  const urls = loaded(['--input-type=module', '-e', "await import('@agentage/extension/host')"]);
  expect(urls.some((url) => HEAVY[0]?.test(url))).toBe(true);
});
