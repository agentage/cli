import { defineConfig } from '@playwright/test';
import { testClientHeader } from './e2e/client-type.js';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  // A test that passes only on its retry still fails the run: a flake is a bug to fix.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { extraHTTPHeaders: { ...testClientHeader() } },
});
