/**
 * @smoke - the built CLI identifies itself and degrades cleanly when
 * unauthenticated, against the live deployed target (AGENTAGE_SITE_FQDN,
 * default dev). No credentials needed.
 */
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, statusJson, type CliMachine } from './helpers.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

let machine: CliMachine;

test.beforeAll(() => {
  assertCliBuilt();
  machine = createCliMachine();
});

test.afterAll(() => machine.cleanup());

test('version matches the package version @smoke', async () => {
  const result = await machine.exec(['--version']);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(pkg.version);
});

test('unauthenticated status degrades with a setup hint @smoke', async () => {
  const report = await statusJson(machine);
  expect(report.auth.signedIn).toBe(false);
  expect(report.auth.note).toContain('agentage setup');
  expect(report.endpoint.reachable, `endpoint ${report.endpoint.url} unreachable`).toBe(true);
});

test('status never leaks a stack trace when signed out @smoke', async () => {
  const result = await machine.exec(['status']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('not signed in - run: agentage setup');
  expect(result.stdout + result.stderr).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
});
