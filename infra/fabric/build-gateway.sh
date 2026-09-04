#!/usr/bin/env bash
###############################################################################
# build-gateway.sh — build the NestJS gateway + its workspace deps in Ubuntu so
# it can run against the live peer (LEDGER_BACKEND=fabric). Copies the four
# packages into $DST (default ~/ayurtrace) and builds them in dependency order.
#
# Notes learned standing this up:
#  - Use `npm ci` for contracts/seed/chaincode (their locks are in sync; ci skips
#    the huge full-metadata "packument" fetches — a big win on a slow link).
#  - The gateway's committed lock is stale, so use `npm install` there (regenerates
#    it). In this WSL environment npm sometimes prints "added N packages" then hangs
#    without exiting, so we cap it with `timeout` and verify success by result
#    (node_modules present) rather than by npm's exit code.
#
# Usage: ./build-gateway.sh [path-to-ayurtrace-repo]   (default ../../ of this file)
###############################################################################
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:-$(cd "$HERE/../.." && pwd)}"
DST="${GW_DST:-$HOME/ayurtrace}"
export npm_config_audit=false npm_config_fund=false npm_config_progress=false
export npm_config_fetch_timeout=600000 npm_config_fetch_retries=5

echo "REPO=$REPO  DST=$DST"
rm -rf "$DST"; mkdir -p "$DST"
for d in packages/contracts seed chaincode/ayurledger apps/gateway; do
  mkdir -p "$DST/$(dirname "$d")"
  ( cd "$REPO" && tar --exclude=node_modules --exclude=dist --exclude=.git -cf - "$d" ) | ( cd "$DST" && tar -xf - )
done

build_ci() { # $1 dir  $2 dist-check
  echo "### $1 (npm ci)"; cd "$DST/$1"
  { npm ci || npm install; } >/tmp/gwb-$(basename "$1").log 2>&1
  npm run build >>/tmp/gwb-$(basename "$1").log 2>&1
  [ -f "$DST/$1/$2" ] || { echo "FAIL $1"; tail -20 /tmp/gwb-$(basename "$1").log; exit 1; }
  echo "  OK $1"
}
build_ci packages/contracts   dist/index.js
build_ci seed                 dist/index.js
build_ci chaincode/ayurledger dist/service.js

echo "### apps/gateway (npm install; capped — npm may hang after finishing)"
cd "$DST/apps/gateway"; rm -f package-lock.json
timeout 1200 npm install >/tmp/gwb-gateway.log 2>&1 || true
if [ ! -d node_modules/@hyperledger/fabric-gateway ] || [ ! -d node_modules/@nestjs/core ]; then
  echo "FAIL gateway install (deps missing)"; tail -20 /tmp/gwb-gateway.log; exit 1
fi
npm run build >>/tmp/gwb-gateway.log 2>&1
[ -f dist/main.js ] || { echo "FAIL gateway build"; tail -25 /tmp/gwb-gateway.log; exit 1; }
echo "  OK apps/gateway"
echo "BUILD-GATEWAY OK -> $DST/apps/gateway  (run: infra/fabric/run-gateway.sh)"
