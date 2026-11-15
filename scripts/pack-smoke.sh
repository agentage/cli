#!/usr/bin/env bash
# The packed cli with ONLY its declared dependencies (--omit=dev, empty prefix) starts, and its
# daemon serves /health; the kit host's optional peers (express, PGlite) resolve from the kit.
# Usage: scripts/pack-smoke.sh <cli.tgz>
set -euo pipefail
tarball=$(realpath "$1")
expected=$(tar -xOzf "$tarball" package/package.json | node -p 'JSON.parse(require("fs").readFileSync(0)).version')
work=$(mktemp -d)
daemon=
trap 'if [ -n "$daemon" ]; then kill "$daemon" 2>/dev/null || true; fi; rm -rf "$work"' EXIT
npm i -g "$tarball" --omit=dev --prefix "$work/prefix" --no-audit --no-fund > /dev/null
export PATH="$work/prefix/bin:$PATH" AGENTAGE_CONFIG_DIR="$work/config"
export AGENTAGE_DAEMON_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; cat "$work/daemon.log" 2>/dev/null; exit 1; }
got=$(agentage --version)
[ "$got" = "$expected" ] && pass "--version: $got" || fail "--version: $got, expected $expected"
agentage --help > /dev/null && pass "--help" || fail "--help"
agentage daemon status --json | grep -q '"running":false' && pass "daemon status: not running" || fail "daemon status"

kit="$work/prefix/lib/node_modules/@agentage/cli/node_modules/@agentage/extension"
(cd "$kit" && node --input-type=module -e "
await import('express');
const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
const { rows } = await db.query('select 1 as one');
if (rows[0].one !== 1) process.exit(1);
await db.close();") && pass "express and PGlite resolve from the kit; PGlite answers select 1" || fail "kit peers"

agentage daemon run > "$work/daemon.log" 2>&1 &
daemon=$!
for _ in $(seq 100); do
  body=$(curl -fsS "http://127.0.0.1:$AGENTAGE_DAEMON_PORT/health" 2>/dev/null) && break
  sleep 0.2
done
echo "${body:-}" | grep -q '"service":"agentage-daemon"' && pass "daemon run: /health $body" || fail "daemon run: no /health"
agentage daemon status --json | grep -q '"running":true' && pass "daemon status: running" || fail "daemon status"
agentage daemon stop > /dev/null && pass "daemon stop" || fail "daemon stop"
