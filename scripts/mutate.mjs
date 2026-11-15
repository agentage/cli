// Mutation check of the rule tests: each mutation breaks one rule, runs its tests, restores the file.
// Usage: node scripts/mutate.mjs [ids...] (e.g. M9 M10b). Never beside verify: it edits src.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { INSTALL } from './mutations-install.mjs';
import { M as BASE } from './mutations.mjs';

const M = [...BASE, ...INSTALL];

const repo = join(import.meta.dirname, '..');
const only = process.argv.slice(2);

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
    // A vitest that did not start proves nothing: an ERROR, never KILLED.
    const started = !r.error && r.status !== null;
    const killed = started && r.status !== 0;
    const verdict = !started
      ? `ERROR (vitest did not start: ${r.error?.message ?? r.signal})`
      : killed
        ? 'KILLED (red)'
        : 'SURVIVED (tests green)';
    console.log(`${id}: ${verdict} | ${tail.join(' | ').replace(/\s+/g, ' ').slice(0, 300)}`);
    return killed;
  } finally {
    back();
  }
};

// Exit 1 when a mutation survives, errs or its pattern is gone, so a stale table is red too.
let bad = 0;
for (const [id, file, from, to, tests] of M) {
  if (only.length && !only.some((o) => id.startsWith(o + ' '))) continue;
  if (!runOne(id, file, from, to, tests)) bad += 1;
}
if (bad > 0) console.log(`${bad} mutation(s) survived, erred or did not apply`);
process.exit(bad > 0 ? 1 : 0);
