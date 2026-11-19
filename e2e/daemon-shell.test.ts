/**
 * @offline - the shell the daemon serves is the bundled kit's (0.20.2): rendered in Chromium,
 * the nav foot holds the Inbox bell, as on the deployed app host.
 */
import { createServer } from 'node:net';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, type CliMachine } from './helpers.js';

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

let machine: CliMachine;
let url: string;

test.beforeAll(async () => {
  assertCliBuilt();
  const port = await freePort();
  machine = createCliMachine({ AGENTAGE_NO_DAEMON: undefined, AGENTAGE_DAEMON_PORT: String(port) });
  const started = await machine.exec(['daemon', 'start', '--json'], 60_000);
  expect(started.code, started.stderr).toBe(0);
  url = (JSON.parse(started.stdout) as { data: { url: string } }).data.url;
});

test.afterAll(async () => {
  await machine.exec(['daemon', 'stop']);
  machine.cleanup();
});

test('the daemon serves the kit 0.20.2 shell: the Inbox bell sits in the nav foot @offline', async ({
  page,
}) => {
  await page.goto(`${url}/`);
  const bell = page.locator('.foot [data-region="notices"] button.inboxbtn');
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAttribute('aria-label', /^Inbox/);
});
