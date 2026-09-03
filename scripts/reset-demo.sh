#!/usr/bin/env bash
# Deterministic re-seed + golden-path replay for repeat dry runs (execution plan M5).
set -euo pipefail
BASE="${1:-http://localhost:3001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if curl -fsS -X POST "$BASE/admin/reset-demo" >/dev/null 2>&1; then
  echo "Live gateway reseeded at $BASE."
fi
echo "Replaying golden path (in-process) ..."
( cd "$ROOT/apps/gateway" && LEDGER_BACKEND=demo node golden-path.mjs )
