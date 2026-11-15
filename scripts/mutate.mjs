// Mutation check of the rule tests: each mutation breaks one rule, runs its tests, restores the file.
// Usage: node scripts/mutate.mjs [ids...] (e.g. M9 M10b). Never beside verify: it edits src.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const only = process.argv.slice(2);
const M = [
  [
    'M1 stop: no proof before SIGTERM',
    'src/lib/daemon/daemon-stop.ts',
    '  if (!proven(file, found)) return (removeDaemonFile(), { stale: file.pid });\n',
    '',
    ['src/lib/daemon/daemon-stop.test.ts'],
  ],
  [
    'M1b down: no /health proof before SIGTERM',
    'src/commands/extension/up-local.ts',
    "  if ((await answerOf(record)) !== 'ours') return (removeRecord(dir), 'stale');\n",
    '',
    ['src/commands/extension/up-run.test.ts'],
  ],
  [
    'M2 up: CI=true counts as no CI',
    'src/commands/extension/up.ts',
    "!['', 'false', '0', undefined].includes(env['CI'])",
    "!['', 'false', '0', 'true', undefined].includes(env['CI'])",
    ['src/commands/extension/up.test.ts'],
  ],
  [
    'M3 create --from: no terminal needs no --yes',
    'src/commands/extension/create-install.ts',
    '  if (!io.isTTY)\n',
    '  if (false)\n',
    ['src/commands/extension/create-install.test.ts'],
  ],
  [
    'M3b create --from: --yes ignored',
    'src/commands/extension/create-install.ts',
    '  if (opts.yes) return;\n',
    '',
    ['src/commands/extension/create-install.test.ts'],
  ],
  [
    'M4 move: no marker check (runs every start)',
    'src/commands/daemon/move.ts',
    '  if (existsSync(marker)) return;\n',
    '',
    ['src/commands/daemon/move.test.ts', 'src/commands/daemon/move-daemon.test.ts'],
  ],
  [
    'M4b move: a row replaces the list (rows lost)',
    'src/commands/daemon/move.ts',
    'extensions: [...doc.extensions, row as',
    'extensions: [row as',
    ['src/commands/daemon/move.test.ts', 'src/commands/daemon/move-daemon.test.ts'],
  ],
  [
    'M4c move: a rerun adds the same id again',
    'src/commands/daemon/move.ts',
    'doc.extensions.some((r) => r.id === row.id)',
    'false',
    ['src/commands/daemon/move.test.ts', 'src/commands/daemon/move-daemon.test.ts'],
  ],
  [
    'M4d move: daemon values lose to the profile',
    'src/commands/daemon/move.ts',
    '{ ...settings, ...mine }',
    '{ ...mine, ...settings }',
    ['src/commands/daemon/move.test.ts', 'src/commands/daemon/move-daemon.test.ts'],
  ],
  [
    'M5 envelope: no success object',
    'src/lib/json-output.ts',
    '    if (!legacy) io.writeOut(`${envelope(data)}\\n`);\n',
    '',
    ['src/program-json.test.ts', 'src/lib/json-output.test.ts'],
  ],
  [
    'M5b exit: a failed action exits 0',
    'src/program.ts',
    '  if (err.code === ACTION_FAILED) return EXIT_FAILED;',
    '  if (err.code === ACTION_FAILED) return EXIT_OK;',
    ['src/program-json.test.ts', 'src/program.test.ts', 'src/program-failures.test.ts'],
  ],
  [
    'M5c exit: a --json usage error has no envelope',
    'src/program.ts',
    "  writeError(deps, err, 'usage');",
    '',
    ['src/program-json.test.ts', 'src/program.test.ts'],
  ],
  [
    'M6 guard: up asks the kit for no guard',
    'src/commands/extension/up-run.ts',
    '{ ...opts, localOnly: true }',
    'opts',
    ['src/commands/extension/up-run.test.ts'],
  ],
  [
    'M7 restart: an older daemon serves',
    'src/lib/daemon/daemon-client.ts',
    'compareVersions(health.version, VERSION) < 0',
    'false',
    ['src/lib/daemon/daemon-client.test.ts'],
  ],
  [
    'M7b restart: the same version restarts',
    'src/lib/daemon/daemon-client.ts',
    'compareVersions(health.version, VERSION) < 0',
    'compareVersions(health.version, VERSION) <= 0',
    ['src/lib/daemon/daemon-client.test.ts'],
  ],
  [
    'M8 move: another live daemon is a move warning',
    'src/commands/daemon/move.ts',
    "    if ((err as { code?: unknown }).code === 'DAEMON_RUNNING') throw err;\n",
    '',
    ['src/commands/daemon/move-lock.test.ts'],
  ],
  [
    'M8b daemon run: a second daemon is a plain error',
    'src/commands/daemon/run.ts',
    "  if (code !== 'DAEMON_RUNNING') throw err;",
    '  throw err;',
    ['src/commands/daemon/run.test.ts'],
  ],
  [
    'M11 update all: one id npm cannot resolve stops the rest',
    'src/commands/extension/lifecycle-list.ts',
    '      return null;\n    });',
    '      throw err;\n    });',
    ['src/commands/extension/lifecycle-list.test.ts'],
  ],
  [
    'M9 install: no npm on a site with no market',
    'src/commands/daemon/installer.ts',
    'if (!version && down && !noSiteMarket(down)) throw',
    'if (!version && down) throw',
    ['src/commands/daemon/installer.test.ts'],
  ],
  [
    'M9b update: no npm on a site with no market',
    'src/commands/extension/lifecycle-list.ts',
    'if (to || (down && !noSiteMarket(down))) return',
    'if (true) return',
    ['src/commands/extension/lifecycle-list.test.ts'],
  ],
  [
    'M9c an unreachable market falls back to npm',
    'src/lib/net/market-error.ts',
    "err?.code === 'no_discovery' || err?.code === 'no_market'",
    'err !== null',
    ['src/commands/daemon/installer.test.ts', 'src/commands/extension/lifecycle-list.test.ts'],
  ],
  [
    'M10 kit 0.12 refused',
    'src/core/loader/manifest.ts',
    'return onPreviousKit(engine, kit) ? null :',
    'return false ? null :',
    ['src/core/loader/manifest.test.ts', 'src/core/loader/discover.test.ts'],
  ],
  [
    'M10b any kit range let through',
    'src/core/loader/manifest.ts',
    'versions.some((v) => satisfies(v, engine))',
    'true',
    ['src/core/loader/manifest.test.ts'],
  ],
  [
    'M10c npm gate refuses kit 0.12',
    'src/core/installer/compat.ts',
    ' || onPreviousKit(p.engine, gate.kit)',
    '',
    ['src/commands/daemon/installer.test.ts'],
  ],
  [
    'M10d no warning for kit 0.12',
    'src/core/loader/discover.ts',
    'warning: kitWarning(info)',
    'warning: null',
    ['src/core/loader/discover.test.ts', 'src/commands/extension/doctor.test.ts'],
  ],
];

// The file under mutation goes back on every exit: a thrown error, Ctrl-C, a SIGTERM.
let restore = null;
const back = () => {
  restore?.();
  restore = null;
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    back();
    process.exit(130);
  });

const runOne = (id, file, from, to, tests) => {
  const path = join(repo, file);
  const orig = readFileSync(path, 'utf8');
  if (orig.split(from).length !== 2) return (console.log(`${id}: PATTERN NOT FOUND ONCE`), false);
  restore = () => writeFileSync(path, orig);
  try {
    writeFileSync(path, orig.replace(from, to));
    const r = spawnSync('npx', ['vitest', 'run', ...tests], {
      cwd: repo,
      encoding: 'utf8',
      env: process.env,
    });
    const tail = (r.stdout + r.stderr)
      .split('\n')
      .filter((l) => /Tests\s+\d|FAIL|✗|×/.test(l))
      .slice(0, 4);
    const killed = r.status !== 0;
    console.log(
      `${id}: ${killed ? 'KILLED (red)' : 'SURVIVED (tests green)'} | ${tail.join(' | ').replace(/\s+/g, ' ').slice(0, 300)}`
    );
    return killed;
  } finally {
    back();
  }
};

// Exit 1 when a mutation survives or its pattern is gone, so a stale table is red too.
let bad = 0;
for (const [id, file, from, to, tests] of M) {
  if (only.length && !only.some((o) => id.startsWith(o + ' '))) continue;
  if (!runOne(id, file, from, to, tests)) bad += 1;
}
if (bad > 0) console.log(`${bad} mutation(s) survived or did not apply`);
process.exit(bad > 0 ? 1 : 0);
