/**
 * Hermetic couch account-sync tier: drives the REAL built CLI + daemon end to end against a REAL
 * couchdb:3.4 container and a node:http stub for discovery/token/provision. Nothing here touches a
 * deployed stack. Gated on docker: without it the whole tier skips (with a reason). @couch
 *
 * The couch JWT recipe (proven in a prior spike): the jwt handler must be in the config AT STARTUP
 * (a runtime PUT does not engage it); the hmac key can then be set at runtime. The stub mints a
 * REAL HS256 token couch must accept - that proves the production auth mode, not a bypass.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as netServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CouchSync, createCouchState, encodeFile, type FetchLike } from '@agentage/memory-core';
import { expect, test } from '@playwright/test';
import { createCliMachine, freePort, type CliMachine } from './helpers.js';

const run = promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The couch user id: the JWT `sub`, and the only member of every per-test db.
const SUB = 'cli-couch-e2e';
const VAULT = 'acct';

const dockerAvailable = (): boolean => {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const DOCKER = dockerAvailable();

const freeTcpPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = netServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });

// --- couchdb:3.4 harness (adapted from web/packages/couch-bridge/test/couch-harness.ts) --------
const IMAGE = 'couchdb:3.4';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'm5-admin-pw';
const LOCAL_INI = [
  '[chttpd]',
  'authentication_handlers = {chttpd_auth, jwt_authentication_handler}, ' +
    '{chttpd_auth, cookie_authentication_handler}, {chttpd_auth, default_authentication_handler}',
  '',
  '[jwt_auth]',
  'required_claims = exp',
  '',
].join('\n');

interface Couch {
  url: string;
  adminAuth: string;
  jwtSecret: string;
  stop(): Promise<void>;
}

const waitUp = async (url: string): Promise<void> => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/_up`)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`couch not up at ${url}`);
    await sleep(250);
  }
};

const startCouch = async (): Promise<Couch> => {
  const port = await freeTcpPort();
  const name = `cli-couch-it-${randomUUID().slice(0, 8)}`;
  const dir = await mkdtemp(join(tmpdir(), 'cli-couch-it-'));
  const ini = join(dir, 'zz-agentage.ini');
  await writeFile(ini, LOCAL_INI, 'utf8');
  const stop = async (): Promise<void> => {
    await run('docker', ['rm', '-f', name]).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  };
  try {
    // create + cp + start: a ro bind mount trips the image entrypoint's chown -R.
    await run('docker', [
      'create',
      '--name',
      name,
      '-p',
      `127.0.0.1:${port}:5984`,
      '-e',
      `COUCHDB_USER=${ADMIN_USER}`,
      '-e',
      `COUCHDB_PASSWORD=${ADMIN_PASS}`,
      IMAGE,
    ]);
    await run('docker', ['cp', ini, `${name}:/opt/couchdb/etc/local.d/zz-agentage.ini`]);
    await run('docker', ['start', name]);

    const url = `http://127.0.0.1:${port}`;
    const adminAuth = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
    await waitUp(url);
    for (const db of ['_users', '_replicator']) {
      const res = await fetch(`${url}/${db}`, {
        method: 'PUT',
        headers: { Authorization: adminAuth },
      });
      if (!res.ok && res.status !== 412) throw new Error(`system db ${db} failed (${res.status})`);
    }
    const jwtSecret = `m5-secret-${randomUUID()}`;
    const res = await fetch(`${url}/_node/_local/_config/jwt_keys/hmac%3A_default`, {
      method: 'PUT',
      headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify(Buffer.from(jwtSecret).toString('base64')),
    });
    if (!res.ok) throw new Error(`jwt key set failed (${res.status})`);
    return { url, adminAuth, jwtSecret, stop };
  } catch (e) {
    await stop();
    throw e;
  }
};

// A fresh per-test db whose only member is the JWT subject - proves the real member-scoped auth.
const createDb = async (couch: Couch): Promise<string> => {
  const db = `mem_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const create = await fetch(`${couch.url}/${db}`, {
    method: 'PUT',
    headers: { Authorization: couch.adminAuth },
  });
  if (!create.ok) throw new Error(`create db failed (${create.status})`);
  const sec = await fetch(`${couch.url}/${db}/_security`, {
    method: 'PUT',
    headers: { Authorization: couch.adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      admins: { names: [], roles: [] },
      members: { names: [SUB], roles: [] },
    }),
  });
  if (!sec.ok) throw new Error(`_security failed (${sec.status})`);
  return db;
};

const b64url = (s: string): string => Buffer.from(s).toString('base64url');

// A real HS256 JWT (kid _default) couch validates against hmac:_default = base64(secret).
const mintJwt = (secret: string, ttlSec = 3600): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: '_default' }));
  const payload = b64url(JSON.stringify({ sub: SUB, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
};

const docUrl = (couch: Couch, db: string, id: string): string =>
  `${couch.url}/${db}/${encodeURIComponent(id)}`;

const getDoc = async (
  couch: Couch,
  db: string,
  id: string
): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await fetch(docUrl(couch, db, id), { headers: { Authorization: couch.adminAuth } });
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
};

// Insert a proper file+leaf doc pair with the content-addressed shape, replicated-style.
const putFile = async (couch: Couch, db: string, path: string, content: string): Promise<void> => {
  const { leaves, fileDoc } = await encodeFile(path, content);
  const rev = `1-${createHash('md5').update(JSON.stringify(fileDoc.leaves)).digest('hex')}`;
  const res = await fetch(`${couch.url}/${db}/_bulk_docs`, {
    method: 'POST',
    headers: { Authorization: couch.adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_edits: false, docs: [...leaves, { ...fileDoc, _rev: rev }] }),
  });
  if (!res.ok) throw new Error(`_bulk_docs failed (${res.status})`);
};

// --- discovery / token / provision stub (a single server, all origins collapse onto it) --------
interface Stub {
  port: number;
  requests(): number;
  setDb(db: string): void;
  setTokenFail(fail: boolean): void;
  // Map an extra vault name onto the current db (the discover tier registers 'teamnotes' at runtime).
  addVault(name: string): void;
  // The vault names the daemon POSTed to /api/memories (proves the discover watcher provisioned).
  provisioned(): string[];
  stop(): Promise<void>;
}

const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
        );
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });

const startStub = async (couch: Couch): Promise<Stub> => {
  const port = await freeTcpPort();
  let db = '';
  let count = 0;
  let tokenFail = false;
  const vaultNames = new Set<string>([VAULT]);
  const provisioned: string[] = [];
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    count += 1;
    const url = (req.url ?? '').split('?')[0] ?? '';
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url === '/.well-known/agentage-sync')
      return send(200, {
        git_endpoint: `http://127.0.0.1:${port}/git`,
        vaults: [],
        couch_endpoint: couch.url,
        couch_token_url: `http://127.0.0.1:${port}/account/couch-token`,
        couch_vaults: [...vaultNames].map((vault) => ({ vault, db })),
        ttl: 60,
      });
    if (req.method === 'POST' && url === '/account/couch-token') {
      if (tokenFail) return send(401, { error: 'unauthorized' });
      // expSec 61 = the client cache lapses after ~1s (60s skew), so a test can force a re-mint;
      // the JWT itself stays valid for an hour.
      return send(200, {
        success: true,
        data: { jwt: mintJwt(couch.jwtSecret), db, sub: SUB, expSec: 61 },
      });
    }
    if (req.method === 'POST' && url === '/api/memories') {
      void readJson(req).then((body) => {
        if (typeof body['name'] === 'string') provisioned.push(body['name']);
        send(200, { success: true });
      });
      return;
    }
    send(404, { error: 'not found' });
  };
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    requests: () => count,
    setDb: (d) => {
      db = d;
    },
    setTokenFail: (f) => {
      tokenFail = f;
    },
    addVault: (name) => void vaultNames.add(name),
    provisioned: () => [...provisioned],
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

// --- machine helpers ----------------------------------------------------------------------------
const fakeAuth = (m: CliMachine, stubPort: number): void =>
  writeFileSync(
    join(m.configDir, 'auth.json'),
    JSON.stringify({
      siteFqdn: `127.0.0.1:${stubPort}`,
      clientId: 'stub-client',
      tokens: { accessToken: 'stub-oauth-bearer', expiresAt: Date.now() + 3_600_000 },
    })
  );

// Pin the account origin to interval 0 (manual-only) so no background timer races assertions.
const setManual = (m: CliMachine): void => {
  const p = join(m.configDir, 'vaults.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as {
    vaults: Record<string, { origin: { remote: string; interval?: number }[] }>;
  };
  cfg.vaults[VAULT]!.origin[0]!.interval = 0;
  writeFileSync(p, JSON.stringify(cfg, null, 2));
};

interface Machine {
  m: CliMachine;
  vaultDir: string;
  cleanup(): Promise<void>;
}

// A CLI machine wired to the stub, an account vault added + the daemon started.
const bootMachine = async (stub: Stub, opts: { signedIn: boolean }): Promise<Machine> => {
  const daemonPort = await freePort();
  const m = createCliMachine({
    AGENTAGE_SITE_FQDN: `127.0.0.1:${stub.port}`,
    AGENTAGE_NO_DAEMON: '',
    AGENTAGE_DAEMON_PORT: String(daemonPort),
  });
  if (opts.signedIn) fakeAuth(m, stub.port);
  const vaultDir = join(m.configDir, VAULT);
  const add = await m.exec(['vault', 'add', VAULT, '--path', vaultDir]);
  expect(add.code, add.stderr).toBe(0);
  setManual(m);
  const start = await m.exec(['daemon', 'start']);
  expect(start.code, start.stderr).toBe(0);
  return {
    m,
    vaultDir,
    cleanup: async () => {
      await m.exec(['daemon', 'stop']).catch(() => {});
      m.cleanup();
    },
  };
};

const waitFor = async (predicate: () => Promise<boolean>, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(200);
  }
  throw new Error('waitFor: condition not met in time');
};

test.describe('couch account sync (hermetic) @couch', () => {
  test.skip(!DOCKER, 'docker unavailable - couch account-sync tier skipped');
  test.describe.configure({ timeout: 90_000 });

  let couch: Couch;
  let stub: Stub;

  test.beforeAll(async () => {
    if (!DOCKER) return;
    couch = await startCouch();
    stub = await startStub(couch);
  });
  test.afterAll(async () => {
    await stub?.stop();
    await couch?.stop();
  });

  test('sync-on-save pushes a write to couch; status shows the couch vault', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, vaultDir, cleanup } = await bootMachine(stub, { signedIn: true });
    try {
      const body = 'account note pushed over the couch channel';
      expect((await m.exec(['memory', 'write', 'notes/x.md', '--body', body])).code).toBe(0);

      // The engine stored the serialized doc on disk; the couch leaf is content-addressed off it.
      const onDisk = readFileSync(join(vaultDir, 'notes/x.md'), 'utf8');
      const { fileDoc, leaves } = await encodeFile('notes/x.md', onDisk);
      const leaf = leaves[0]!;
      await waitFor(async () => (await getDoc(couch, db, fileDoc._id)).status === 200);
      const stored = await getDoc(couch, db, fileDoc._id);
      expect(stored.json['path']).toBe('notes/x.md');
      expect(stored.json['leaves']).toEqual(fileDoc.leaves);
      const storedLeaf = await getDoc(couch, db, leaf._id);
      expect(storedLeaf.status).toBe(200);
      expect(storedLeaf.json['data']).toBe(leaf.data);

      const status = await m.exec(['daemon', 'status']);
      expect(status.stdout).toContain('couch sync');
      expect(status.stdout).toContain(VAULT);
    } finally {
      await cleanup();
    }
  });

  test('a file inserted into couch pulls to disk, commits, and reads back', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, vaultDir, cleanup } = await bootMachine(stub, { signedIn: true });
    try {
      await putFile(couch, db, 'notes/y.md', 'pulled from couch into the mirror\n');

      const sync = await m.exec(['vault', 'sync', VAULT]);
      expect(sync.code, sync.stderr).toBe(0);

      const disk = join(vaultDir, 'notes/y.md');
      expect(existsSync(disk), sync.stdout).toBe(true);
      expect(readFileSync(disk, 'utf8')).toContain('pulled from couch');
      const gitLog = await run('git', ['-C', vaultDir, 'log', '--oneline']);
      expect(gitLog.stdout).toContain('sync: couch');
      const read = await m.exec(['memory', 'read', 'notes/y.md']);
      expect(read.stdout).toContain('pulled from couch');
    } finally {
      await cleanup();
    }
  });

  test('deletes propagate both directions', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, vaultDir, cleanup } = await bootMachine(stub, { signedIn: true });
    try {
      // CLI delete -> couch tombstone.
      expect((await m.exec(['memory', 'write', 'notes/z.md', '--body', 'delete me'])).code).toBe(0);
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/z.md')).status === 200);
      expect((await m.exec(['memory', 'delete', 'notes/z.md'])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/z.md')).status === 404);

      // Couch tombstone -> local file removed.
      await putFile(couch, db, 'notes/w.md', 'temporary, soon removed by couch\n');
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      expect(existsSync(join(vaultDir, 'notes/w.md'))).toBe(true);
      const cur = await getDoc(couch, db, 'f:notes/w.md');
      await fetch(`${docUrl(couch, db, 'f:notes/w.md')}?rev=${cur.json['_rev'] as string}`, {
        method: 'DELETE',
        headers: { Authorization: couch.adminAuth },
      });
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      expect(existsSync(join(vaultDir, 'notes/w.md'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('signed out: sync pauses, CRUD still works, zero couch requests', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, cleanup } = await bootMachine(stub, { signedIn: false });
    try {
      const before = stub.requests();
      expect(
        (await m.exec(['memory', 'write', 'notes/s.md', '--body', 'works offline'])).code
      ).toBe(0);
      expect((await m.exec(['memory', 'read', 'notes/s.md'])).stdout).toContain('works offline');

      const sync = await m.exec(['vault', 'sync', VAULT]);
      expect(sync.code, sync.stderr).toBe(0);
      expect(sync.stdout).toContain('paused (signed out)');

      await sleep(400); // let any fire-and-forget push settle
      expect(stub.requests(), 'signed-out sync must make zero network calls').toBe(before);
    } finally {
      await cleanup();
    }
  });

  test('a signed-out delete tombstones after sign-in; a fresh replica never resurrects it', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, cleanup } = await bootMachine(stub, { signedIn: true });
    try {
      // Two synced docs: keep.md stays, del.md is deleted while signed out.
      expect((await m.exec(['memory', 'write', 'notes/keep.md', '--body', 'stays'])).code).toBe(0);
      expect((await m.exec(['memory', 'write', 'notes/del.md', '--body', 'doomed'])).code).toBe(0);
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/del.md')).status === 200);

      // Signed out: the delete succeeds locally and queues a durable deletion, no tombstone yet.
      rmSync(join(m.configDir, 'auth.json'));
      const del = await m.exec(['memory', 'delete', 'notes/del.md']);
      expect(del.code, del.stderr).toBe(0);
      await sleep(500); // let the fire-and-forget enqueue persist
      expect((await getDoc(couch, db, 'f:notes/del.md')).status).toBe(200);

      // Sign back in and sync: the queued deletion becomes the couch tombstone.
      fakeAuth(m, stub.port);
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/del.md')).status === 404);

      // A fresh second replica replaying the feed from cursor 0 pulls keep.md but never del.md.
      const files = new Map<string, string>();
      const store = {
        listMarkdown: async () => [...files.keys()],
        read: async (p: string) => files.get(p) ?? null,
        write: async (p: string, b: string) => void files.set(p, b),
        remove: async (p: string) => void files.delete(p),
      };
      const state = await createCouchState({ load: async () => null, save: async () => {} });
      const fetchLike: FetchLike = (url, init) => fetch(url, init as RequestInit);
      const replica = new CouchSync(
        store,
        { endpoint: couch.url, db },
        fetchLike,
        async () => mintJwt(couch.jwtSecret),
        () => {},
        state
      );
      await replica.pullOnce();
      expect(files.has('notes/keep.md'), 'replica pulled live content').toBe(true);
      expect(files.has('notes/del.md'), 'deleted doc must not resurrect').toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('a delete during a token-endpoint outage converges once tokens recover', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    const { m, cleanup } = await bootMachine(stub, { signedIn: true });
    try {
      expect((await m.exec(['memory', 'write', 'notes/q.md', '--body', 'target'])).code).toBe(0);
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/q.md')).status === 200);

      // Let the daemon's short-lived token cache lapse, then 401 every mint during the delete.
      await sleep(1200);
      stub.setTokenFail(true);
      const del = await m.exec(['memory', 'delete', 'notes/q.md']);
      expect(del.code, del.stderr).toBe(0);
      await sleep(500); // the live tombstone fails against the 401 and self-queues
      expect((await getDoc(couch, db, 'f:notes/q.md')).status).toBe(200);

      // Token endpoint recovers: the next cycle drains the queued deletion.
      stub.setTokenFail(false);
      expect((await m.exec(['vault', 'sync', VAULT])).code).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:notes/q.md')).status === 404);
    } finally {
      await cleanup();
    }
  });

  test('live-discovers a folder dropped into a discover root, then honors remove+ignore', async () => {
    const db = await createDb(couch);
    stub.setDb(db);
    stub.addVault('teamnotes'); // the discovered account vault resolves to this test's db
    const daemonPort = await freePort();
    const m = createCliMachine({
      AGENTAGE_SITE_FQDN: `127.0.0.1:${stub.port}`,
      AGENTAGE_NO_DAEMON: '',
      AGENTAGE_DAEMON_PORT: String(daemonPort),
      // Short knobs (floored at 1000/50ms) keep the tier deterministic even where fs.watch is flaky.
      AGENTAGE_DISCOVER_POLL_MS: '1000',
      AGENTAGE_DISCOVER_DEBOUNCE_MS: '150',
    });
    fakeAuth(m, stub.port);
    const rootDir = join(m.configDir, 'discover-root');
    mkdirSync(rootDir, { recursive: true });
    const vaultsPath = join(m.configDir, 'vaults.json');
    // autosync:false -> discovered entries are interval 0 (manual-only): no background timer race.
    writeFileSync(
      vaultsPath,
      JSON.stringify(
        { version: 1, discover: [{ path: rootDir, autosync: false }], vaults: {} },
        null,
        2
      )
    );
    interface Cfg {
      vaults?: Record<string, { origin?: { remote: string; interval?: number }[]; mcp?: string[] }>;
      discover?: { path: string; ignore?: string[] }[];
    }
    const readCfg = (): Cfg => JSON.parse(readFileSync(vaultsPath, 'utf8')) as Cfg;

    const start = await m.exec(['daemon', 'start']);
    expect(start.code, start.stderr).toBe(0);
    try {
      // Drop a new folder (with a note) plus an invalid-named folder into the watched root.
      mkdirSync(join(rootDir, 'teamnotes'));
      writeFileSync(
        join(rootDir, 'teamnotes', 'note.md'),
        '# team note\nfrom a discovered folder\n'
      );
      mkdirSync(join(rootDir, 'bad name!'));

      // WITHOUT a daemon restart the watcher registers teamnotes as an account vault.
      await waitFor(async () => Boolean(readCfg().vaults?.teamnotes));
      const entry = readCfg().vaults!.teamnotes!;
      expect(entry.origin?.[0]).toEqual({ remote: 'agentage', interval: 0 }); // account shape
      expect(entry.mcp).toEqual(['local']);
      expect(readCfg().vaults?.['bad name!'], 'invalid names never register').toBeUndefined();

      // The watcher provisioned the discovered vault's cloud channel.
      await waitFor(async () => stub.provisioned().includes('teamnotes'));

      // /api/sync/status lists both the discover root and the new couch target.
      await waitFor(async () => {
        const s = (await (
          await fetch(`http://127.0.0.1:${daemonPort}/api/sync/status`)
        ).json()) as { couch?: { vault: string }[]; discover?: { roots: string[] } };
        return (
          (s.discover?.roots ?? []).includes(rootDir) &&
          (s.couch ?? []).some((c) => c.vault === 'teamnotes')
        );
      });

      // A manual sync pushes the dropped note to couch as f:note.md.
      const sync = await m.exec(['vault', 'sync', 'teamnotes']);
      expect(sync.code, sync.stderr).toBe(0);
      await waitFor(async () => (await getDoc(couch, db, 'f:note.md')).status === 200);

      // Remove appends the name to the root's ignore in the same save (V8).
      const removed = await m.exec(['vault', 'remove', 'teamnotes']);
      expect(removed.code, removed.stderr).toBe(0);
      expect(removed.stdout).toContain('ignore');
      expect(readCfg().discover?.[0]?.ignore).toContain('teamnotes');
      expect(readCfg().vaults?.teamnotes).toBeUndefined();

      // Touch the folder again: an ignored name is never re-discovered.
      writeFileSync(join(rootDir, 'teamnotes', 'note2.md'), 'second note\n');
      await sleep(2500); // > debounce + several poll cycles
      expect(readCfg().vaults?.teamnotes, 'ignored folder must not be re-added').toBeUndefined();
    } finally {
      await m.exec(['daemon', 'stop']).catch(() => {});
      m.cleanup();
    }
  });
});
