import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

// The real modules, transpiled, so the child runs the shipped retry with no test runner around it.
const transpileSrc = (root: string): void => {
  for (const file of [...sources(join(SRC, 'lib')), ...sources(join(SRC, 'utils'))]) {
    const dest = join(root, 'src', relative(SRC, file)).replace(/\.ts$/, '.js');
    const out = ts.transpileModule(readFileSync(file, 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out, 'utf-8');
  }
  copyFileSync(join(SRC, '..', 'package.json'), join(root, 'package.json'));
};

const childScript = (root: string): string => {
  const mod = (path: string): string => pathToFileURL(join(root, 'src', 'lib', path)).href;
  const script = join(root, 'introspect.mjs');
  writeFileSync(
    script,
    `import { introspectToken } from '${mod('auth/introspect.js')}';\n` +
      `import { links } from '${mod('net/origins.js')}';\n` +
      `const fqdn = process.argv[2];\n` +
      `const auth = { siteFqdn: fqdn, clientId: 'c1', tokens: { accessToken: 'at' } };\n` +
      `process.stdout.write(JSON.stringify(await introspectToken(auth, links(fqdn))));\n`,
    'utf-8'
  );
  return script;
};

describe('introspectToken retry in a real process', () => {
  let root: string;
  let server: Server;
  let calls = 0;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'agentage-introspect-'));
    transpileSrc(root);
    // Connection: close leaves nothing but the backoff timer to keep the child alive.
    server = createServer((_req, res) => {
      calls += 1;
      const body =
        calls === 1 ? {} : { userId: 'u1', accessTokenExpiresAt: '2030-01-01T00:00:00Z' };
      res.writeHead(calls === 1 ? 503 : 200, {
        'content-type': 'application/json',
        connection: 'close',
      });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }, 30_000);

  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('waits out the backoff after a 503 and exits 0 with the session (never 13)', async () => {
    const fqdn = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const env = { ...process.env, AGENTAGE_CONFIG_DIR: join(root, 'cfg') };
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) => {
        execFile(process.execPath, [childScript(root), fqdn], { env }, (err, stdout, stderr) => {
          const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
          resolve({ code, stdout, stderr });
        });
      }
    );
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ userId: 'u1', expiresAt: '2030-01-01T00:00:00Z' });
    expect(calls).toBe(2);
  }, 30_000);
});
