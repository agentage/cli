import { defineConfig } from '@playwright/test';
import { testClientHeader } from './e2e/client-type.js';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  // No retries: the tiers are hermetic, so a flake is a bug to fix, never a second chance.
  retries: 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { extraHTTPHeaders: { ...testClientHeader() } },
});
