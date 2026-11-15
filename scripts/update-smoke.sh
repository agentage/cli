#!/usr/bin/env bash
# A user of 0.51.1 updates to this tarball (D6): 0.51.1 from npm writes its own state, the
# candidate is installed over it, and `extension list` shows each entry as 0.51 left it: running,
# disabled, or skipped (named why); the 0.51 files stay byte-identical.
# Usage: scripts/update-smoke.sh <cli.tgz>   (needs the npm registry)
set -euo pipefail
tarball=$(realpath "$1")
work=$(mktemp -d)
trap 'agentage daemon stop > /dev/null 2>&1 || true; rm -rf "$work"' EXIT
export PATH="$work/prefix/bin:$PATH" AGENTAGE_CONFIG_DIR="$work/config"
export AGENTAGE_DAEMON_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; cat "$AGENTAGE_CONFIG_DIR/logs/daemon.log" 2>/dev/null | tail -20; exit 1; }
running() { echo "$1" | grep -o '"state":"running"' | wc -l | tr -d ' '; }
# row <id> <version> <source> <state>: extension list --json ($list) has that row.
row() { echo "$list" | node -e 'const [id, version, source, state] = process.argv.slice(1);
const rows = JSON.parse(require("fs").readFileSync(0)).data;
process.exit(rows.some((r) => r.id === id && r.version === version && r.source === source && r.state === state) ? 0 : 1)' "$@"; }
sums() { (cd "$AGENTAGE_CONFIG_DIR" && sha256sum profile.json machine.json extensions/current); }

# A kit extension folder with an api part and the echo.prefix setting, as a 0.51 dev link.
folder() { node -e '
const fs = require("fs"), dir = process.argv[1];
fs.mkdirSync(dir + "/dist/api", { recursive: true });
const settings = { "echo.prefix": { type: "string", default: "" } };
const agentage = { id: "demo", parts: { api: true }, settings };
fs.writeFileSync(dir + "/package.json", JSON.stringify({ name: "@agentage/extension-demo",
  version: "0.1.0", type: "module", agentage, engines: { node: ">=22", agentage: ">=0.12" } }));
fs.writeFileSync(dir + "/dist/agentage-extension.json",
  JSON.stringify({ id: "demo", version: "0.1.0", parts: { api: {} }, commands: [] }));
fs.writeFileSync(dir + "/dist/api/index.js", "export const create = (ctx) => (req, res) => " +
  "res.json({ success: true, data: { msg: [ctx.settings?.[\"echo.prefix\"], new URL(req.url, \"http://x\")" +
  ".searchParams.get(\"msg\")].filter(Boolean).join(\" \") } });\n");' "$1"; }
folder "$work/demo"
folder "$work/loose"
sed -i 's/"demo"/"loose"/g; s/extension-demo/extension-loose/' "$work/loose/package.json" "$work/loose/dist/agentage-extension.json"

for try in 1 2 3; do
  npm i -g @agentage/cli@0.51.1 --prefix "$work/prefix" --no-audit --no-fund > /dev/null && break
  [ "$try" = 3 ] && fail "npm install of 0.51.1 failed 3 times"
  sleep 10
done
[ "$(agentage --version)" = "0.51.1" ] || fail "0.51.1 did not install"
(cd "$work" && agentage extension install @agentage/extension-probe@0.6.2 --off > /dev/null) || fail "0.51.1 install probe --off"
(cd "$work" && agentage extension install ./demo > /dev/null) || fail "0.51.1 install ./demo"
(cd "$work" && agentage extension install ./loose > /dev/null) || fail "0.51.1 install ./loose"
# Another user can now write to it: the move must skip it, never run it.
chmod o+w "$work/loose"
# 0.51 had no configure: its setting came from the account profile's config map.
node -e 'const f=process.argv[1], p=JSON.parse(require("fs").readFileSync(f));
p.config={ demo: { "echo.prefix": "hey" } }; require("fs").writeFileSync(f, JSON.stringify(p));' "$AGENTAGE_CONFIG_DIR/profile.json"
old=$(sums)
pass "0.51.1 state: probe 0.6.2 from npm (off), demo and loose as dev folders, echo.prefix=hey"

npm i -g "$tarball" --omit=dev --prefix "$work/prefix" --no-audit --no-fund > /dev/null
bin=$(realpath "$(command -v agentage)")
want=$(tar -xOzf "$tarball" package/dist/cli.js | sha256sum | cut -d' ' -f1)
[ "$bin" = "$(realpath "$work/prefix")/lib/node_modules/@agentage/cli/dist/cli.js" ] && [ "$(sha256sum < "$bin" | cut -d' ' -f1)" = "$want" ] \
  && pass "under test: $bin, $(agentage --version), dist/cli.js sha256 ${want:0:12} = the tarball's" || fail "agentage is not the tarball: $bin"
for _ in $(seq 120); do
  list=$(agentage extension list --json 2>/dev/null) || list=
  [ "$(running "$list")" = 1 ] && echo "$list" | grep -q '"state":"disabled"' && break
  sleep 0.5
done
echo "$list"
curl -fsS "http://127.0.0.1:$AGENTAGE_DAEMON_PORT/health" | grep -q '"service":"agentage-daemon"' && pass "/health answers after the update" || fail "no /health after the update"
row demo 0.1.0 folder running && pass "demo 0.1.0 (folder) running" || fail "demo not running: $list"
row probe 0.6.2 market disabled && pass "probe 0.6.2 (market) disabled, as 0.51 had it off" || fail "probe not disabled: $list"
echo "$list" | grep -q '"id":"loose"' && fail "the unsafe folder runs: $list"
grep -q 'loose' "$AGENTAGE_CONFIG_DIR/installation.moved.json" && grep -q 'world-writable' "$AGENTAGE_CONFIG_DIR/installation.moved.json" \
  && pass "loose skipped: $(node -p 'JSON.stringify(require(process.argv[1]).skipped)' "$AGENTAGE_CONFIG_DIR/installation.moved.json")" || fail "loose not listed as skipped"
agentage extension enable probe > /dev/null || fail "enable probe"
agentage ping | grep -q pong && pass "probe enabled; the moved 0.6.2 keeps its command: agentage ping" || fail "agentage ping"
agentage status 2>&1 | grep -q 'warning: probe: built on kit 0.12, update the extension' && pass "status warns: probe built on kit 0.12" || fail "status: no kit 0.12 warning"
curl -fsS "http://127.0.0.1:$AGENTAGE_DAEMON_PORT/api/demo/echo?msg=hi" | grep -q '"hey hi"' && pass "the moved setting: demo echo answers hey hi" || fail "setting not moved"
[ "$(sums)" = "$old" ] && pass "the 0.51 files are byte-identical (sha256)" || fail "0.51 files changed: $(sums)"
[ -f "$AGENTAGE_CONFIG_DIR/installation.moved" ] && pass "marker written" || fail "no marker"
before=$(cat "$AGENTAGE_CONFIG_DIR/installation.json")
agentage daemon restart > /dev/null 2>&1
[ "$(cat "$AGENTAGE_CONFIG_DIR/installation.json")" = "$before" ] && pass "a second start moves nothing" || fail "second start changed installation.json"
