import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertCliBuilt, createCliMachine, freePort, type CliMachine } from './helpers.js';

// Frozen MCP contract behavior tier. mcp-daemon.test.ts proves the tool surface exists (6 tools,
// dual-channel output); this proves the BEHAVIORS a bad @agentage/server-memory or
// @agentage/memory-core bump could regress: str_replace edit edge cases, @<vault>/ routing over
// two vaults, bounded search pagination, soft-delete recoverability from git, list-tree shapes,
// and the per-connection instructions block. Ephemeral port + isolated AGENTAGE_CONFIG_DIR keep it
// off the real daemon; fully offline (local git working-copy vaults, loopback transport). @p0

interface ToolResult {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  tools?: Array<{ name: string }>;
  instructions?: string;
  serverInfo?: { name: string };
}

const rpc = async (
  port: number,
  method: string,
  params: unknown
): Promise<{ result?: ToolResult; error?: { message: string } }> => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(res.ok, `POST /mcp ${method} -> ${res.status}`).toBe(true);
  return (await res.json()) as { result?: ToolResult; error?: { message: string } };
};

// tools/call never surfaces a JSON-RPC protocol error: a handler throw or a validation refusal is
// returned as a tool result with isError=true (MCP SDK contract), so assert no error, return result.
const callTool = async (
  port: number,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> => {
  const body = await rpc(port, 'tools/call', { name, arguments: args });
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result ?? {};
};

const initialize = async (port: number): Promise<ToolResult> => {
  const body = await rpc(port, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  });
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result ?? {};
};

const text = (r: ToolResult): string => r.content?.[0]?.text ?? '';

const pidOf = (m: CliMachine): number | null => {
  const p = join(m.configDir, 'daemon.pid');
  return existsSync(p) ? Number.parseInt(readFileSync(p, 'utf-8').trim(), 10) : null;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface Daemon {
  m: CliMachine;
  port: number;
  pid: number | null;
}

// Register the named local vaults, start an ephemeral-port daemon over them, hand back the handle.
const startDaemon = async (vaults: string[]): Promise<Daemon> => {
  const port = await freePort();
  const m = createCliMachine({ AGENTAGE_NO_DAEMON: '', AGENTAGE_DAEMON_PORT: String(port) });
  for (const name of vaults) {
    const add = await m.exec(['vault', 'add', name, '--local', join(m.configDir, name)]);
    expect(add.code, add.stderr).toBe(0);
  }
  const start = await m.exec(['daemon', 'start']);
  expect(start.code, start.stderr).toBe(0);
  return { m, port, pid: pidOf(m) };
};

const stopDaemon = async (d: Daemon): Promise<void> => {
  await d.m.exec(['daemon', 'stop']);
  try {
    if (d.pid !== null && alive(d.pid)) process.kill(d.pid, 'SIGKILL');
  } catch {
    // already gone - the SIGKILL is only a leak guard
  }
  d.m.cleanup();
};

const git = (dir: string, args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });

test.describe('frozen MCP contract behaviors @p0', () => {
  test.beforeAll(() => assertCliBuilt());

  test('memory__edit str_replace edge cases surface the canonical errors', async () => {
    const d = await startDaemon(['main']);
    try {
      // (a) new_str omitted deletes the matched old_str in place.
      await callTool(d.port, 'memory__write', { path: 'e/del.md', body: 'keep REMOVE keep' });
      const del = await callTool(d.port, 'memory__edit', {
        path: 'e/del.md',
        mode: 'str_replace',
        old_str: 'REMOVE ',
      });
      expect(del.isError, text(del)).toBeFalsy();
      expect(del.structuredContent?.path).toBe('e/del.md');
      const afterDel = await callTool(d.port, 'memory__read', { path: 'e/del.md' });
      expect(afterDel.structuredContent?.body).toBe('keep keep');

      // (b) body alongside str_replace mode is refused with the canonical message.
      const bodyClash = await callTool(d.port, 'memory__edit', {
        path: 'e/del.md',
        mode: 'str_replace',
        old_str: 'keep',
        body: 'nope',
      });
      expect(bodyClash.isError).toBe(true);
      expect(text(bodyClash)).toContain(
        'mode=str_replace edits in place via old_str/new_str - do not send body'
      );

      // (c) old_str/new_str without mode=str_replace is refused.
      const noMode = await callTool(d.port, 'memory__edit', {
        path: 'e/del.md',
        old_str: 'keep',
        new_str: 'kept',
      });
      expect(noMode.isError).toBe(true);
      expect(text(noMode)).toContain('old_str/new_str work only with mode="str_replace".');

      // (d) a duplicate old_str returns the multiple-occurrences error THROUGH the MCP transport
      // (the backend throws; the SDK renders it as an isError tool result, not a protocol error).
      await callTool(d.port, 'memory__write', { path: 'e/dup.md', body: 'x here and x there' });
      const dup = await callTool(d.port, 'memory__edit', {
        path: 'e/dup.md',
        mode: 'str_replace',
        old_str: 'x',
        new_str: 'y',
      });
      expect(dup.isError).toBe(true);
      expect(text(dup)).toContain('Multiple occurrences of old_str');

      // Single-vault instructions omit the @<vault>/ addressing line and stay under budget.
      const init = await initialize(d.port);
      const instructions = init.instructions ?? '';
      expect(instructions.length).toBeGreaterThan(0);
      expect(instructions.length).toBeLessThan(2048);
      expect(instructions).not.toContain('@<vault>/');
    } finally {
      await stopDaemon(d);
    }
  });

  test('@<vault>/ routing addresses, scopes, and isolates two registered vaults', async () => {
    const d = await startDaemon(['alpha', 'beta']);
    try {
      const wa = await callTool(d.port, 'memory__write', {
        path: '@alpha/notes/a.md',
        body: 'alpha apple',
      });
      expect(wa.structuredContent?.path).toBe('@alpha/notes/a.md');
      const wb = await callTool(d.port, 'memory__write', {
        path: '@beta/notes/b.md',
        body: 'beta banana betamarker',
      });
      expect(wb.structuredContent?.path).toBe('@beta/notes/b.md');

      // list root surfaces every vault as a top-level @<vault> folder.
      const roots = await callTool(d.port, 'memory__list', {});
      expect(roots.structuredContent?.folder).toBe('');
      const rootPaths = (roots.structuredContent?.entries as Array<{ path: string }>).map(
        (e) => e.path
      );
      expect(rootPaths).toContain('@alpha');
      expect(rootPaths).toContain('@beta');

      // read/edit/delete accept @<vault>/<path>.
      const read = await callTool(d.port, 'memory__read', { path: '@alpha/notes/a.md' });
      expect(read.structuredContent?.body).toContain('alpha apple');
      const edit = await callTool(d.port, 'memory__edit', {
        path: '@alpha/notes/a.md',
        mode: 'append',
        body: 'more',
      });
      expect(edit.structuredContent?.path).toBe('@alpha/notes/a.md');

      // search folder:"@beta" scopes to beta and prefixes every hit; the same query scoped to
      // @alpha finds nothing - a write to @beta is invisible in @alpha.
      const inBeta = await callTool(d.port, 'memory__search', {
        query: 'betamarker',
        folder: '@beta',
      });
      const betaHits = inBeta.structuredContent?.results as Array<{ path: string }>;
      expect(betaHits.length).toBeGreaterThan(0);
      expect(betaHits.every((h) => h.path.startsWith('@beta/'))).toBe(true);
      const inAlpha = await callTool(d.port, 'memory__search', {
        query: 'betamarker',
        folder: '@alpha',
      });
      expect((inAlpha.structuredContent?.results as unknown[]).length).toBe(0);

      // an unscoped search fans out across both vaults and still prefixes the vault.
      const fanout = await callTool(d.port, 'memory__search', { query: 'betamarker' });
      expect(
        (fanout.structuredContent?.results as Array<{ path: string }>).map((h) => h.path)
      ).toContain('@beta/notes/b.md');

      const del = await callTool(d.port, 'memory__delete', { path: '@beta/notes/b.md' });
      expect(del.structuredContent?.deleted).toBe(true);
      expect(del.structuredContent?.path).toBe('@beta/notes/b.md');

      // Multi-vault instructions carry the @<vault>/ addressing line, name both vaults, stay bounded.
      const init = await initialize(d.port);
      const instructions = init.instructions ?? '';
      expect(instructions.length).toBeLessThan(2048);
      expect(instructions).toContain('@<vault>/');
      expect(instructions).toContain('alpha');
      expect(instructions).toContain('beta');
    } finally {
      await stopDaemon(d);
    }
  });

  test('memory__search honors limit and round-trips cursor pagination', async () => {
    const d = await startDaemon(['main']);
    try {
      // Distinct match counts give a deterministic score-desc order: a(3) > b(2) > c(1).
      await callTool(d.port, 'memory__write', { path: 'p/a.md', body: 'quokka quokka quokka' });
      await callTool(d.port, 'memory__write', { path: 'p/b.md', body: 'quokka quokka here' });
      await callTool(d.port, 'memory__write', { path: 'p/c.md', body: 'quokka once' });

      const page1 = await callTool(d.port, 'memory__search', { query: 'quokka', limit: 2 });
      const p1 = (page1.structuredContent?.results as Array<{ path: string }>).map((r) => r.path);
      expect(p1).toEqual(['p/a.md', 'p/b.md']);
      const cursor = page1.structuredContent?.nextCursor;
      expect(typeof cursor).toBe('string');
      expect(text(page1)).toContain('More: call memory__search again with cursor');

      const page2 = await callTool(d.port, 'memory__search', {
        query: 'quokka',
        limit: 2,
        cursor,
      });
      const p2 = (page2.structuredContent?.results as Array<{ path: string }>).map((r) => r.path);
      expect(p2).toEqual(['p/c.md']);
      expect(page2.structuredContent?.nextCursor).toBeUndefined();
      // No overlap between pages; together they cover every hit.
      expect(p2.some((path) => p1.includes(path))).toBe(false);
    } finally {
      await stopDaemon(d);
    }
  });

  test('memory__delete is a soft delete recoverable from git history', async () => {
    const d = await startDaemon(['main']);
    const vaultDir = join(d.m.configDir, 'main');
    try {
      const path = 'keep/recover.md';
      await callTool(d.port, 'memory__write', {
        path,
        body: 'irreplaceable prose worth recovering',
      });
      const del = await callTool(d.port, 'memory__delete', { path });
      expect(del.structuredContent?.deleted).toBe(true);
      expect(text(del)).toContain('soft-delete, recoverable');

      // The working copy no longer holds the file and a read reports not-found...
      expect(existsSync(join(vaultDir, path))).toBe(false);
      const read = await callTool(d.port, 'memory__read', { path });
      expect(read.isError).toBe(true);
      expect(text(read)).toContain(`No memory at path "${path}"`);

      // ...yet the content is still recoverable from the vault's git history (the product promise).
      const history = git(vaultDir, ['log', '-p', '--', path]);
      expect(history).toContain('irreplaceable prose worth recovering');
      const priorRev = git(vaultDir, ['rev-list', '-1', 'HEAD^', '--', path]).trim();
      expect(git(vaultDir, ['show', `${priorRev}:${path}`])).toContain(
        'irreplaceable prose worth recovering'
      );
    } finally {
      await stopDaemon(d);
    }
  });

  test('memory__list tree shapes: depth, per-folder counts, truncated flag, tags filter', async () => {
    const d = await startDaemon(['main']);
    try {
      await callTool(d.port, 'memory__write', { path: 'root-note.md', body: 'top' });
      await callTool(d.port, 'memory__write', { path: 'projx/one.md', body: 'one' });
      await callTool(d.port, 'memory__write', { path: 'projx/two.md', body: 'two' });
      await callTool(d.port, 'memory__write', { path: 'projx/sub/deep.md', body: 'deep' });
      await callTool(d.port, 'memory__write', {
        path: 'projy/tagged.md',
        body: 'tagged',
        frontmatter: { tags: ['proj'] },
      });

      // depth 1: subfolders appear as unexpanded stubs (no entries), with recursive file counts.
      const d1 = await callTool(d.port, 'memory__list', { depth: 1 });
      expect(d1.structuredContent?.files).toBe(5);
      expect(typeof d1.structuredContent?.truncated).toBe('boolean');
      expect(d1.structuredContent?.truncated).toBe(false);
      const x1 = (
        d1.structuredContent?.entries as Array<{ path: string; files?: number; entries?: unknown }>
      ).find((e) => e.path === 'projx');
      expect(x1?.files).toBe(3);
      expect(x1?.entries).toBeUndefined();

      // depth 2 expands one level deeper: projx now lists its own children.
      const d2 = await callTool(d.port, 'memory__list', { depth: 2 });
      const x2 = (
        d2.structuredContent?.entries as Array<{ path: string; entries?: Array<{ path: string }> }>
      ).find((e) => e.path === 'projx');
      expect(Array.isArray(x2?.entries)).toBe(true);
      const childPaths = (x2?.entries ?? []).map((c) => c.path);
      expect(childPaths).toContain('projx/one.md');
      expect(childPaths).toContain('projx/two.md');
      expect(childPaths).toContain('projx/sub');

      // tags filter narrows to the single tagged memory.
      const tagged = await callTool(d.port, 'memory__list', { tags: ['proj'] });
      expect(tagged.structuredContent?.files).toBe(1);
    } finally {
      await stopDaemon(d);
    }
  });

  // FINDING: secret refusal is DESCRIPTION-ONLY upstream - memory__write/edit descriptions say
  // secrets "are refused" but neither register-tools.js nor memory-core enforces it, so a
  // credential body writes through. Nothing to assert without a fake-passing test.
  test.skip('memory__write refuses obvious secrets (not enforced upstream)', () => {});

  // FINDING: memory__read returns the full body verbatim (memory-core local-backend read ->
  // doc.body); there is no byte/line budget or truncation on read. Nothing to assert.
  test.skip('memory__read returns a bounded body (no read budget upstream)', () => {});
});
