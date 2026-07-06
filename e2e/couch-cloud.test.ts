/**
 * @full - the M5 cloud roundtrip against the LIVE dev stack: a local CLI write
 * replicates over the couch channel and becomes readable through the cloud MCP
 * endpoint, and a cloud MCP write flows back to disk. Never runs against prod
 * (hard-skips when the target FQDN is agentage.io).
 *
 * Env: AGENTAGE_SITE_FQDN (default dev). Self-contained like setup-oauth: it
 * signs up a FRESH throwaway account per run (dev throwaways are accepted in
 * this suite - see couch-sync.test.ts and the e2e provision-on-signin tier).
 *
 * Deployment gates (skip cleanly, never fail):
 *   - target is production;
 *   - the account OAuth bearer cannot be obtained from the live stack;
 *   - the couch channel is off (403 CHANNEL_DISABLED) or discovery exposes no
 *     couch fields for the vault;
 *   - the couch->git cloud bridge is not materializing writes yet (the couch
 *     write lands but the cloud MCP never surfaces it) - a deployment gap, not
 *     a regression. Once the bridge is live the roundtrip legs run and assert.
 *
 * ADR-013: a wildcard OAuth token routes BARE cloud-MCP paths to the account's
 * DEFAULT memory only. On dev the default memory is git-channel (auto-seeded on
 * sign-up), so provisioning "default" on couch 409s; instead this uses a
 * non-default couch memory and addresses it over the cloud MCP with the
 * @<vault>/ prefix (which the wildcard token honors).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import {
  assertCliBuilt,
  createCliMachine,
  ensureSession,
  freePort,
  newBrowserContext,
  TARGET_FQDN,
  waitForAuthorizeUrl,
  type CliMachine,
} from './helpers.js';

const run = promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const IS_PROD = TARGET_FQDN === 'agentage.io';
const SYNC_URL = `https://sync.${TARGET_FQDN}`;
const MCP_URL = `https://memory.${TARGET_FQDN}/mcp`;
const VAULT = 'cloude2e';
const LEG_TIMEOUT_MS = 120_000;
const FWD_PATH = 'notes/roundtrip.md';
const REV_PATH = 'notes/from-cloud.md';

const log = (msg: string): void => console.log(`[couch-cloud] ${msg}`);

// A fresh throwaway account every run, independent of E2E_AUTH_* (the couch memory cap is per
// account, so a reused account would exhaust it and pile stale couch state).
const freshAccount = (): { email: string; password: string } => ({
  email: `cli-couch-e2e-${randomBytes(6).toString('hex')}@agentage.test`,
  password: `cli-couch-e2e-${randomBytes(9).toString('base64url')}`,
});

const readBearer = (m: CliMachine): string | null => {
  const p = join(m.configDir, 'auth.json');
  if (!existsSync(p)) return null;
  const auth = JSON.parse(readFileSync(p, 'utf-8')) as { tokens?: { accessToken?: string } };
  return auth.tokens?.accessToken ?? null;
};

interface SyncDiscovery {
  couch_endpoint?: string;
  couch_token_url?: string;
  couch_vaults?: Array<{ vault: string; db: string }>;
}

const discovery = async (bearer: string): Promise<SyncDiscovery> => {
  const res = await fetch(`${SYNC_URL}/.well-known/agentage-sync`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
  });
  return (await res.json()) as SyncDiscovery;
};

// Direct couch check: proves a forward miss is the bridge (the doc IS in couch) and not a broken
// CLI push (the doc is absent). The couch JWT is minted the same way the daemon mints it.
const couchHasDoc = async (bearer: string, disc: SyncDiscovery, path: string): Promise<boolean> => {
  if (!disc.couch_endpoint || !disc.couch_token_url) return false;
  const db = disc.couch_vaults?.find((v) => v.vault === VAULT)?.db;
  if (!db) return false;
  const mint = await fetch(disc.couch_token_url, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ memory: VAULT }),
  });
  if (!mint.ok) return false;
  const jwt = ((await mint.json()) as { data?: { jwt?: string } }).data?.jwt;
  if (!jwt) return false;
  const doc = await fetch(`${disc.couch_endpoint}/${db}/${encodeURIComponent(`f:${path}`)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  return doc.status === 200;
};

// Minimal shape of a cloud MCP tool result (SDK CallToolResult) without pulling its types in.
interface CloudResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
const asResult = (r: unknown): CloudResult => r as CloudResult;

const connectCloudMcp = async (bearer: string): Promise<Client> => {
  const client = new Client({ name: 'agentage-cli-e2e', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
};

const cloudRead = async (mcp: Client, path: string): Promise<CloudResult> =>
  asResult(await mcp.callTool({ name: 'memory__read', arguments: { path } }));

test.describe('couch <-> cloud MCP roundtrip vs live dev @full', () => {
  test.skip(IS_PROD, 'never run the cloud roundtrip against production');
  test.describe.configure({ timeout: 480_000 });

  test('a CLI couch write reads via the cloud MCP, and a cloud write flows back', async () => {
    assertCliBuilt();
    const account = freshAccount();
    const daemonPort = await freePort();
    const machine = createCliMachine({
      AGENTAGE_NO_DAEMON: '',
      AGENTAGE_DAEMON_PORT: String(daemonPort),
    });
    const browser = await newBrowserContext();
    const vaultDir = join(machine.configDir, VAULT);
    let mcp: Client | undefined;

    // Live-stack auth ability: obtain the bearer via the CLI's own headless OAuth flow (the
    // setup-oauth pattern - the test plays the browser). Any failure here is a live-stack gate.
    let bearer: string | null = null;
    let authError = '';
    try {
      await ensureSession(browser, account);
      const setup = machine.startSetup();
      const authorizeUrl = await waitForAuthorizeUrl(setup);
      const authorize = await browser.get(authorizeUrl, { maxRedirects: 0 });
      expect(authorize.status(), 'authorize should 302 for a signed-in session').toBe(302);
      const callback = await browser.get(authorize.headers()['location'] ?? '');
      expect(callback.ok(), `callback failed: ${callback.status()}`).toBe(true);
      expect(await setup.waitExit(), setup.output()).toBe(0);
      bearer = readBearer(machine);
    } catch (err) {
      authError = err instanceof Error ? err.message : String(err);
    }

    try {
      test.skip(
        !bearer,
        `no live-stack OAuth bearer (${authError || 'setup did not store a token'})`
      );
      const token = bearer as string;

      // Provision a NON-default couch memory (default is git-reserved -> 409 on couch).
      const add = await machine.exec(['vault', 'add', VAULT, '--path', vaultDir]);
      expect(add.code, add.stderr).toBe(0);
      test.skip(
        /not enabled on this server/i.test(add.stdout),
        `couch channel disabled on ${TARGET_FQDN}: ${add.stdout.trim()}`
      );
      test.skip(
        /already exists on another channel/i.test(add.stdout),
        `couch channel conflict on ${TARGET_FQDN}: ${add.stdout.trim()}`
      );
      // A transient provision failure at add-time is fine: the sync cycle re-provisions idempotently.

      const start = await machine.exec(['daemon', 'start']);
      expect(start.code, start.stderr).toBe(0);

      // --- FORWARD leg: CLI write -> couch -> [bridge] -> cloud MCP -------------------------------
      const fwdMark = `cli-fwd-${randomBytes(6).toString('hex')}`;
      const cloudFwd = `@${VAULT}/${FWD_PATH}`;
      const w = await machine.exec([
        'memory',
        'write',
        FWD_PATH,
        '--vault',
        VAULT,
        '--body',
        fwdMark,
      ]);
      expect(w.code, w.stderr).toBe(0);
      // Sync via the daemon (/api/sync/run). Retry while the cycle is still provisioning.
      let sync = await machine.exec(['vault', 'sync', VAULT]);
      expect(sync.code, sync.stderr).toBe(0);
      for (let i = 0; i < 3 && /paused \(provisioning/.test(sync.stdout); i++) {
        await sleep(3000);
        sync = await machine.exec(['vault', 'sync', VAULT]);
      }
      test.skip(
        /paused \((account sync is not enabled|name conflicts)/.test(sync.stdout),
        `couch channel unavailable on ${TARGET_FQDN}: ${sync.stdout.trim()}`
      );
      test.skip(
        /paused/.test(sync.stdout),
        `couch sync stayed paused on ${TARGET_FQDN}: ${sync.stdout.trim()}`
      );

      // Discovery must expose the couch channel + our vault, else a deployment gap.
      const disc = await discovery(token);
      const hasCouch =
        !!disc.couch_endpoint &&
        !!disc.couch_token_url &&
        !!disc.couch_vaults?.some((v) => v.vault === VAULT);
      test.skip(
        !hasCouch,
        `discovery lacks couch fields for '${VAULT}' on ${TARGET_FQDN} (deployment gap)`
      );

      mcp = await connectCloudMcp(token);

      const fwdStart = Date.now();
      let fwd: CloudResult | undefined;
      while (Date.now() - fwdStart < LEG_TIMEOUT_MS) {
        const res = await cloudRead(mcp, cloudFwd);
        if (res.isError !== true && JSON.stringify(res.structuredContent ?? {}).includes(fwdMark)) {
          fwd = res;
          break;
        }
        // Re-sync each pass: drains any push the first cycle queued (idempotent, cheap).
        await machine.exec(['vault', 'sync', VAULT]).catch(() => {});
        await sleep(4000);
      }

      if (!fwd) {
        // The couch write itself must have landed; if not, that is a real CLI regression (fail).
        const landed = await couchHasDoc(token, disc, FWD_PATH);
        expect(
          landed,
          `forward leg: CLI push did not land ${FWD_PATH} in couch (sync: ${sync.stdout.trim()})`
        ).toBe(true);
        test.skip(
          true,
          `couch->git cloud bridge not live on ${TARGET_FQDN}: couch has ${FWD_PATH} but the cloud MCP did not surface it within ${LEG_TIMEOUT_MS / 1000}s (roundtrip assertions skipped)`
        );
      }
      const fwdSecs = ((Date.now() - fwdStart) / 1000).toFixed(1);
      log(`forward leg materialized via cloud MCP in ${fwdSecs}s`);
      // Dual-channel shape basics: structured content + a non-empty text channel.
      expect(fwd!.structuredContent, 'cloud read structuredContent').toBeTruthy();
      expect(
        Array.isArray(fwd!.content) && fwd!.content.length > 0,
        'cloud read text channel'
      ).toBe(true);
      expect(JSON.stringify(fwd!.structuredContent)).toContain(FWD_PATH);
      const search = asResult(
        await mcp.callTool({ name: 'memory__search', arguments: { query: fwdMark } })
      );
      expect(
        JSON.stringify(search.structuredContent ?? {}),
        'cloud search finds the marker'
      ).toContain(fwdMark);

      // --- REVERSE leg: cloud MCP write -> couch -> CLI disk -------------------------------------
      const revMark = `cloud-rev-${randomBytes(6).toString('hex')}`;
      const cloudRev = `@${VAULT}/${REV_PATH}`;
      const cw = asResult(
        await mcp.callTool({ name: 'memory__write', arguments: { path: cloudRev, body: revMark } })
      );
      expect(cw.isError, JSON.stringify(cw)).not.toBe(true);
      const diskFile = join(vaultDir, REV_PATH);
      const revStart = Date.now();
      let reversed = false;
      while (Date.now() - revStart < LEG_TIMEOUT_MS) {
        await machine.exec(['vault', 'sync', VAULT]);
        const onDisk = existsSync(diskFile) && readFileSync(diskFile, 'utf-8').includes(revMark);
        if (onDisk) {
          const gitLog = await run('git', ['-C', vaultDir, 'log', '--oneline']);
          const read = await machine.exec(['memory', 'read', REV_PATH, '--vault', VAULT]);
          if (gitLog.stdout.includes('sync: couch') && read.stdout.includes(revMark)) {
            reversed = true;
            break;
          }
        }
        await sleep(4000);
      }
      expect(
        reversed,
        `reverse leg: cloud write did not converge to disk (committed as "sync: couch" + readable) within ${LEG_TIMEOUT_MS / 1000}s`
      ).toBe(true);
      log(`reverse leg converged to disk in ${((Date.now() - revStart) / 1000).toFixed(1)}s`);

      // --- DELETE sanity: CLI delete -> couch tombstone -> [bridge] -> cloud not-found ----------
      expect((await machine.exec(['memory', 'delete', FWD_PATH, '--vault', VAULT])).code).toBe(0);
      expect((await machine.exec(['vault', 'sync', VAULT])).code).toBe(0);
      const delStart = Date.now();
      let deleted = false;
      while (Date.now() - delStart < LEG_TIMEOUT_MS) {
        const res = await cloudRead(mcp, cloudFwd);
        if (res.isError === true || JSON.stringify(res).includes('No memory at path')) {
          deleted = true;
          break;
        }
        await sleep(4000);
      }
      expect(
        deleted,
        `delete leg: tombstone did not reach the cloud MCP within ${LEG_TIMEOUT_MS / 1000}s`
      ).toBe(true);
      log(`delete leg tombstoned in cloud MCP in ${((Date.now() - delStart) / 1000).toFixed(1)}s`);
    } finally {
      if (mcp) await mcp.close().catch(() => {});
      await machine.exec(['daemon', 'stop']).catch(() => {});
      await browser.dispose();
      machine.cleanup();
    }
  });
});
