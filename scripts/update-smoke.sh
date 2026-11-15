#!/usr/bin/env bash
# A user of 0.51.1 updates to this tarball (D6): 0.51.1 from npm writes its own state, the
# candidate is installed over it, and `extension list` shows every entry running: nothing lost.
# Usage: scripts/update-smoke.sh <cli.tgz>   (needs the npm registry)
set -euo pipefail
tarball=$(realpath "$1")
work=$(mktemp -d)
trap 'agentage daemon stop > /dev/null 2>&1 || true; rm -rf "$work"' EXIT
export PATH="$work/prefix/bin:$PATH" AGENTAGE_CONFIG_DIR="$work/config"
export AGENTAGE_DAEMON_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; cat "$AGENTAGE_CONFIG_DIR/logs/daemon.log" 2>/dev/null | tail -20; exit 1; }

# A kit extension folder with an api part and the echo.prefix setting, as a 0.51 dev link.
node -e '
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
  ".searchParams.get(\"msg\")].filter(Boolean).join(\" \") } });\n");' "$work/demo"

npm i -g @agentage/cli@0.51.1 --prefix "$work/prefix" --no-audit --no-fund > /dev/null
[ "$(agentage --version)" = "0.51.1" ] || fail "0.51.1 did not install"
(cd "$work" && agentage extension install @agentage/extension-probe@0.6.2 > /dev/null) || fail "0.51.1 install probe"
(cd "$work" && agentage extension install ./demo > /dev/null) || fail "0.51.1 install ./demo"
# 0.51 had no configure: its setting came from the account profile's config map.
node -e 'const f=process.argv[1], p=JSON.parse(require("fs").readFileSync(f));
p.config={ demo: { "echo.prefix": "hey" } }; require("fs").writeFileSync(f, JSON.stringify(p));' "$AGENTAGE_CONFIG_DIR/profile.json"
old=$(cat "$AGENTAGE_CONFIG_DIR/profile.json" "$AGENTAGE_CONFIG_DIR/machine.json")
pass "0.51.1 state: probe 0.6.2 from npm, demo as a dev folder, echo.prefix=hey"

npm i -g "$tarball" --omit=dev --prefix "$work/prefix" --no-audit --no-fund > /dev/null
pass "candidate $(agentage --version) installed over 0.51.1"
for _ in $(seq 120); do
  list=$(agentage extension list --json 2>/dev/null)
  [ "$(echo "$list" | grep -o '"state":"running"' | wc -l)" = 2 ] && break
  sleep 0.5
done
[ "$(echo "$list" | grep -o '"state":"running"' | wc -l)" = 2 ] && pass "probe and demo running" || fail "not both running: $list"
echo "$list"
for row in '"id":"probe","version":"0.6.2"' '"id":"demo","version":"0.1.0"'; do
  echo "$list" | grep -q "$row" || fail "extension list: no $row"
done
pass "extension list: probe 0.6.2 (market) and demo 0.1.0 (folder)"
agentage ping | grep -q pong && pass "the moved probe 0.6.2 keeps its command: agentage ping" || fail "agentage ping"
curl -fsS "http://127.0.0.1:$AGENTAGE_DAEMON_PORT/api/demo/echo?msg=hi" | grep -q '"hey hi"' && pass "the moved setting: demo echo answers hey hi" || fail "setting not moved"
[ "$(cat "$AGENTAGE_CONFIG_DIR/profile.json" "$AGENTAGE_CONFIG_DIR/machine.json")" = "$old" ] && pass "the 0.51 files are unchanged" || fail "0.51 files changed"
[ -f "$AGENTAGE_CONFIG_DIR/installation.moved" ] && pass "marker written" || fail "no marker"
before=$(cat "$AGENTAGE_CONFIG_DIR/installation.json")
agentage daemon restart > /dev/null 2>&1
[ "$(cat "$AGENTAGE_CONFIG_DIR/installation.json")" = "$before" ] && pass "a second start moves nothing" || fail "second start changed installation.json"
